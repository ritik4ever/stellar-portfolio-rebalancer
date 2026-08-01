import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_DIR = path.resolve(__dirname, '../src');
const LOCALES_DIR = path.resolve(__dirname, '../src/i18n/locales');

// Recursive function to get all files in a directory
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      arrayOfFiles.push(fullPath);
    }
  });

  return arrayOfFiles;
}

// Function to set a nested value in an object given a dot-notated key
function setNestedValue(obj, keyPath, value) {
  const keys = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!current[k]) {
      current[k] = {};
    }
    current = current[k];
  }
  current[keys[keys.length - 1]] = value;
}

// Function to check if a nested key exists
function hasNestedValue(obj, keyPath) {
  const keys = keyPath.split('.');
  let current = obj;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (current[k] === undefined) {
      return false;
    }
    current = current[k];
  }
  return true;
}

// Main audit function
function auditI18n() {
  console.log('Auditing i18n translation keys...');

  // 1. Find all translation keys used in the codebase
  const allFiles = getAllFiles(SRC_DIR);
  const codeFiles = allFiles.filter(file => file.endsWith('.ts') || file.endsWith('.tsx'));
  
  const usedKeys = new Set();
  const tFunctionRegex = /\bt\(['"`]([\w.]+)['"`]\)/g;

  codeFiles.forEach(file => {
    const content = fs.readFileSync(file, 'utf8');
    let match;
    while ((match = tFunctionRegex.exec(content)) !== null) {
      usedKeys.add(match[1]);
    }
  });

  console.log(`Found ${usedKeys.size} unique translation keys referenced in code.`);

  // 2. Read locale files and check for missing keys
  if (!fs.existsSync(LOCALES_DIR)) {
    console.error(`Locales directory not found at: ${LOCALES_DIR}`);
    process.exit(1);
  }

  const localeFiles = fs.readdirSync(LOCALES_DIR).filter(file => file.endsWith('.json'));
  let missingKeysFound = false;

  localeFiles.forEach(localeFile => {
    const localePath = path.join(LOCALES_DIR, localeFile);
    const localeContent = JSON.parse(fs.readFileSync(localePath, 'utf8'));
    
    let updated = false;
    let missingCount = 0;

    usedKeys.forEach(key => {
      if (!hasNestedValue(localeContent, key)) {
        console.log(`[Missing] ${localeFile}: '${key}'`);
        setNestedValue(localeContent, key, `Translation needed: ${key}`);
        updated = true;
        missingCount++;
        missingKeysFound = true;
      }
    });

    if (updated) {
      fs.writeFileSync(localePath, JSON.stringify(localeContent, null, 2) + '\n', 'utf8');
      console.log(`Updated ${localeFile} with ${missingCount} missing key(s).`);
    } else {
      console.log(`${localeFile} is up-to-date.`);
    }
  });

  // 3. Exit with error code if any gaps were found (so CI can catch it)
  if (missingKeysFound) {
    console.error('\nI18n Audit Failed: Missing translation keys were found and automatically added.');
    console.error('Please update the missing translations in the locale files.');
    process.exit(1);
  } else {
    console.log('\nI18n Audit Passed: All translation keys are present in all locales.');
    process.exit(0);
  }
}

auditI18n();
