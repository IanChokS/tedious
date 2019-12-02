import metadataParse, { Metadata } from '../metadata-parser';

import Parser from './stream-parser';
import { InternalConnectionOptions } from '../connection';
import { ColMetadataToken } from './token';
import { TYPE, DataType } from '../data-type';

import { sprintf } from 'sprintf-js';

type CryptoMetaData = {
  ordinal: number,
  userType: any,
  baseTypeInfo: any,
  encryptionAlgo: any,
  algoName?: string,
  encryptionAlgoType: any,
  normVersion: any
}

type EncryptionKeyValue = {
  encryptedKey: Buffer,
  keyStoreName: string,
  keyPath: string,
  asymmetricAlgo: string
}

type EK_INFO = {
  databaseId: number,
  cekId: number,
  cekVersion: number,
  cekMDVersion: number,
  count: number,
  encryptionKeyValue: EncryptionKeyValue[]
}

export type CekTableMetadata = {
  ekValueCount: number,
  eK_INFO: EK_INFO
}

export type ColumnMetadata = Metadata & {
  colName: string,
  tableName?: string | string[],
  cryptoMetaData: CryptoMetaData | undefined
};

function readTableName(parser: Parser, options: InternalConnectionOptions, metadata: Metadata, callback: (tableName?: string | string[]) => void) {
  if (metadata.type.hasTableName) {
    if (options.tdsVersion >= '7_2') {
      parser.readUInt8((numberOfTableNameParts) => {
        const tableName: string[] = [];

        let i = 0;
        function next(done: () => void) {
          if (numberOfTableNameParts === i) {
            return done();
          }

          parser.readUsVarChar((part) => {
            tableName.push(part);

            i++;

            next(done);
          });
        }

        next(() => {
          callback(tableName);
        });
      });
    } else {
      parser.readUsVarChar(callback);
    }
  } else {
    callback(undefined);
  }
}

function readColumnName(parser: Parser, options: InternalConnectionOptions, index: number, metadata: Metadata, callback: (colName: string) => void) {
  parser.readBVarChar((colName) => {
    if (options.columnNameReplacer) {
      callback(options.columnNameReplacer(colName, index, metadata));
    } else if (options.camelCaseColumns) {
      callback(colName.replace(/^[A-Z]/, function (s) {
        return s.toLowerCase();
      }));
    } else {
      callback(colName);
    }
  });
}

function readCryptoMetaData(parser: Parser, options: InternalConnectionOptions, index: number, metadata: Metadata, callback: (cryptoMetaData: CryptoMetaData | undefined) => void) {

  // Based on the TDS doc, 'fEncrypted' is at 11th bit under flags.
  // If it is set to '1', means this column is encrypted
  // If client side enable the encrypted feature, and current column is encrypted, then 
  // program then try to parse CryptoMetaData
  let flags = metadata.flags.toString(2);
  let encrypted;

  if(flags.length >= 12) {
    // get the 11th position (from right to left)
    encrypted = flags.charAt(flags.length - 12) === "1";
  }

  if (options.alwaysEncrypted && encrypted) {
    // Read ordinal as USHORT
    parser.readUInt16LE((ordinal) => {
      // Read userType (Changed to ULONG in TDS 7.2):
      // Depending on the TDS version that is used, valid values are USHORT/ULONG
      // Do not handle special cases for TIMESTAMP and alias types becasue Tedious 
      // currently not support this two types
      (options.tdsVersion < '7_2' ? parser.readUInt16LE : parser.readUInt32LE).call(parser, (userType) => {
        // Read BaseTypeInfo as TYPE_INFO (UInt8) 
        parser.readUInt8((typeNumber) => {
          const type: DataType = TYPE[typeNumber];
          if (!type) {
            return parser.emit('error', new Error(sprintf('Unrecognised data type 0x%02X', typeNumber)));
          }
          // Read encryptionAlgo as BYTE
          parser.readUInt8((encryptionAlgo) => {
            // Read algoName B_VARCHAR
            parser.readBVarChar((algoName) => {
              // Read encryptionAlgoType as BYTE
              parser.readUInt8((encryptionAlgoType) => {
                // Read normVersion as BYTE
                parser.readUInt8((normVersion) => {
                  callback({
                    ordinal: ordinal,
                    userType: userType,
                    baseTypeInfo: type,
                    encryptionAlgo: encryptionAlgo,
                    algoName: algoName,
                    encryptionAlgoType: encryptionAlgoType,
                    normVersion: normVersion
                  })
                })
              })
            })
          })
        })
      })
    })
  } else {
    callback(undefined)
  }
}

// 2.2.7.4 Token Stream Definition Parser -> 'ColumnData'
function readColumnData(parser: Parser, options: InternalConnectionOptions, index: number, callback: (column: ColumnMetadata) => void) {
  metadataParse(parser, options, (metadata) => {
    readTableName(parser, options, metadata, (tableName) => {
      readCryptoMetaData(parser, options, index, metadata, (cryptoMetaData) => {
        readColumnName(parser, options, index, metadata, (colName) => {
          callback({
            userType: metadata.userType,
            flags: metadata.flags,
            type: metadata.type,
            collation: metadata.collation,
            precision: metadata.precision,
            scale: metadata.scale,
            udtInfo: metadata.udtInfo,
            dataLength: metadata.dataLength,
            schema: metadata.schema,
            colName: colName,
            tableName: tableName,
            cryptoMetaData: cryptoMetaData
          });
        });
      })
    });
  });
}

function readColumns(parser: Parser, options: InternalConnectionOptions, columnCount: number, callback: (columns: ColumnMetadata[]) => void) {
  const columns: ColumnMetadata[] = [];

  let i = 0;
  function next(done: () => void) {
    if (i === columnCount) {
      return done();
    }

    readColumnData(parser, options, i, (column) => {
      columns.push(column);

      i++;
      next(done);
    });
  }

  next(() => {
    callback(columns);
  });
}

function readEncryptionKeyValue(parser: Parser, callback: (encryptionKeyValue: EncryptionKeyValue) => void) {
  parser.readUsVarByte((EncryptedKey) => { // The ciphertext containing the encryption key that is secured with the master.
    parser.readBVarChar((KeyStoreName) => { // The key store name component of the location where the master key is saved.
      parser.readUsVarChar((KeyPath) => { // The key path component of the location where the master key is saved
        parser.readBVarChar((AsymmetricAlgo) => { // The name of the algorithm that is used for encrypting the encryption key.
          callback({
            encryptedKey: EncryptedKey,
            keyStoreName: KeyStoreName,
            keyPath: KeyPath,
            asymmetricAlgo: AsymmetricAlgo,
          })
        })
      })
    })
  })
}

// 2.2.7.4 Token Stream Definition Parser -> 'CekTable - > EK_INFO'
function readEk_Info(parser: Parser, EkValueCount: number, callback: (cekTable: CekTableMetadata) => void) {
  let cekTableMetadata: CekTableMetadata;
  let EK_INFO: EK_INFO;
  parser.readUInt32LE((DatabaseId) => { // A 4 byte integer value that represents the database ID where the column encryption key is stored.
    parser.readUInt32LE((CekId) => { // An identifier for the column encryption key.
      parser.readUInt32LE((CekVersion) => { // The key version of the column encryption key.
        parser.readUInt64LE((CekMDVersion) => { // The metadata version for the column encryption key.
          parser.readUInt8((Count) => {
            EK_INFO = {
              databaseId: DatabaseId,
              cekId: CekId,
              cekVersion: CekVersion,
              cekMDVersion: CekMDVersion,
              count: Count,
              encryptionKeyValue: []
            }

            cekTableMetadata = {
              ekValueCount: EkValueCount,
              eK_INFO: EK_INFO
            }

            let i = 0;
            function next(done: () => void){
              if (i === Count) {
                done();
              }

              readEncryptionKeyValue(parser, (encryptionKeyValue) => {
                EK_INFO.encryptionKeyValue.push(encryptionKeyValue)
              })

              i += 1;
              next(done);              
            }
            
            next(() => {
              callback(cekTableMetadata)
            })
          })
        })
      })
    })
  })
}

// 2.2.7.4 Token Stream Definition Parser -> 'CekTable'
function readCekTable(parser: Parser, callback: (cekTable: CekTableMetadata) => void) {
  parser.readUInt16LE((EkValueCount) => {
    readEk_Info(parser, EkValueCount, callback);
  })
}


// 2.2.7.4 Token Stream Definition Parser
function colMetadataParser(parser: Parser, _colMetadata: ColumnMetadata[], options: InternalConnectionOptions, callback: (token: ColMetadataToken) => void) {
  let columnCount: number;
  let cekTableMetadata: CekTableMetadata;

  parser.readUInt16LE((count) => {
    columnCount = count;

    readCekTable(parser, (cekTable) => {
      cekTableMetadata = cekTable;

      readColumns(parser, options, columnCount, (columns) => {
        callback(new ColMetadataToken(cekTableMetadata, columns))
      })
    })
  })
}

export default colMetadataParser;
module.exports = colMetadataParser;
