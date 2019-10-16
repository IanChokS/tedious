import { DataType } from '../data-type';

const IntN: DataType = {
  id: 0x26,
  type: 'INTN',
  name: 'IntN',

  getDataType: function(dataLength: number) {
    const tinyInt = require('./tinyint');
    const smallInt = require('./smallint');
    const int = require('./int');
    const bigInt = require('./bigint');

    switch (dataLength) {
      case 1:
        return tinyInt;

      case 2:
        return smallInt;

      case 4:
        return int;

      case 8:
        return bigInt;

      default: return this;
    }
  },

  declaration() {
    throw new Error('not implemented');
  },

  writeTypeInfo() {
    throw new Error('not implemented');
  },

  writeParameterData() {
    throw new Error('not implemented');
  },

  validate() {
    throw new Error('not implemented');
  }
};

export default IntN;
module.exports = IntN;
