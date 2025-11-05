// This is a placeholder - in a real project, you would generate proper icons
// For now, we'll create SVG placeholders

const fs = require('fs');
const path = require('path');

const sizes = [16, 48, 128];
const publicDir = path.join(__dirname, '../public');

for (const size of sizes) {
  const svg = `
<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" fill="#3B82F6" rx="4"/>
  <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-size="${Math.floor(size * 0.5)}" fill="white" font-weight="bold">C</text>
</svg>
  `.trim();

  fs.writeFileSync(path.join(publicDir, `icon-${size}.png.svg`), svg);
}

console.log('Icons created (SVG placeholders)');
