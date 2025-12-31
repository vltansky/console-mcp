#!/usr/bin/env node

/**
 * Zip extension for Chrome Web Store publishing
 *
 * Usage:
 *   node scripts/release.js
 *   npm run release
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectRoot = path.resolve(__dirname, '..');
const distPath = path.resolve(projectRoot, 'dist');
const srcManifestPath = path.resolve(projectRoot, 'public', 'manifest.json');
const distManifestPath = path.resolve(distPath, 'manifest.json');

const EXCLUDE_PATTERNS = ['*.DS_Store', '*.map', '*.log', 'Thumbs.db'];

function getCurrentVersion() {
  if (!fs.existsSync(srcManifestPath)) {
    console.error('❌ Source manifest not found.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(srcManifestPath, 'utf-8'));
  return manifest.version || '0.0.0';
}

function bumpVersion() {
  const currentVersion = getCurrentVersion();
  const parts = currentVersion.split('.');
  if (parts.length !== 3) {
    console.error(`❌ Invalid version format: ${currentVersion}`);
    process.exit(1);
  }
  const patch = parseInt(parts[2], 10) + 1;
  const newVersion = `${parts[0]}.${parts[1]}.${patch}`;

  const manifest = JSON.parse(fs.readFileSync(srcManifestPath, 'utf-8'));
  manifest.version = newVersion;
  fs.writeFileSync(srcManifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`📈 Version bumped: ${currentVersion} → ${newVersion}`);
  return newVersion;
}

function promptVersionBump() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const currentVersion = getCurrentVersion();
    rl.question(`Bump version from ${currentVersion}? [Y/n]: `, (answer) => {
      rl.close();
      const shouldBump = !answer || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
      resolve(shouldBump);
    });
  });
}

async function checkAndBumpVersion() {
  const shouldBump = await promptVersionBump();
  if (shouldBump) {
    bumpVersion();
  } else {
    console.log('⏭️  Skipping version bump');
  }
}

function runBuild() {
  console.log('🔧 Building extension...');
  const result = spawnSync('npm', ['run', 'build'], {
    stdio: 'inherit',
    cwd: projectRoot,
  });

  if (result.status !== 0) {
    console.error('❌ Build failed');
    process.exit(1);
  }

  console.log('✅ Build complete');
}

function getVersion() {
  if (!fs.existsSync(distManifestPath)) {
    console.error('❌ Manifest not found. Run "npm run build" first.');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(distManifestPath, 'utf-8'));
  return manifest.version || '0.0.0';
}

function createZip() {
  if (!fs.existsSync(distPath)) {
    console.error('❌ Dist folder not found. Run "npm run build" first.');
    process.exit(1);
  }

  const version = getVersion();
  const zipName = `console-bridge-v${version}.zip`;
  const zipPath = path.resolve(projectRoot, zipName);

  if (fs.existsSync(zipPath)) {
    console.log(`🗑️  Removing existing ${zipName}...`);
    fs.unlinkSync(zipPath);
  }

  console.log(`📦 Creating ${zipName}...`);

  const args = ['-r', '-q', zipPath, '.'];
  for (const pattern of EXCLUDE_PATTERNS) {
    args.push('-x', pattern);
  }

  const result = spawnSync('zip', args, { cwd: distPath, stdio: 'inherit' });

  if (result.status !== 0) {
    console.error('❌ zip command failed');
    process.exit(1);
  }

  if (!fs.existsSync(zipPath)) {
    console.error('❌ Zip file was not created');
    process.exit(1);
  }

  const stats = fs.statSync(zipPath);
  const sizeKB = (stats.size / 1024).toFixed(1);

  console.log(`✅ Created: ${zipName} (${sizeKB} KB)`);
  console.log(`🚀 Ready for Chrome Web Store!`);
}

async function main() {
  await checkAndBumpVersion();
  runBuild();
  createZip();
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
