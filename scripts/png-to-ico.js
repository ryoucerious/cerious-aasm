const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;
const fs = require('fs');

const inputPng = 'logo.png';
const squarePng = 'logo-square-256.png';

sharp(inputPng)
  .resize(256, 256, { fit: 'cover' })
  .toFile(squarePng)
  .then(() => pngToIco(squarePng))
  .then(buf => fs.writeFileSync('logo.ico', buf))
  .then(() => console.log('logo.ico created successfully!'))
  .catch(console.error);
