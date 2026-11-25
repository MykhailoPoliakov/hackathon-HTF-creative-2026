const fs = require('fs');
const path = require('path');

const source = path.resolve(__dirname, '..', '..', 'products.en.json');
const target = path.resolve(__dirname, '..', 'public', 'products.json');

if (!fs.existsSync(source)) {
  throw new Error(`English product catalog not found at ${source}`);
}

fs.copyFileSync(source, target);
