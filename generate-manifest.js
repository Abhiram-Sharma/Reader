/**
 * generate-manifest.js
 * ---------------------
 * Pre-deployment script that scans the Books/ directory for PDF files
 * and generates a books.json manifest for the frontend to consume.
 *
 * Usage:  node generate-manifest.js
 */

const fs = require('fs');
const path = require('path');

const BOOKS_DIR = path.join(__dirname, 'Books');
const OUTPUT_FILE = path.join(__dirname, 'books.json');

// Curated palette for book cover cards — each book gets a unique gradient
const COVER_COLORS = [
  ['#667eea', '#764ba2'],   // Indigo → Purple
  ['#f093fb', '#f5576c'],   // Pink → Rose
  ['#4facfe', '#00f2fe'],   // Blue → Cyan
  ['#43e97b', '#38f9d7'],   // Green → Teal
  ['#fa709a', '#fee140'],   // Rose → Gold
  ['#a18cd1', '#fbc2eb'],   // Lavender → Pink
  ['#fccb90', '#d57eeb'],   // Peach → Violet
  ['#e0c3fc', '#8ec5fc'],   // Lilac → Sky
];

/**
 * Converts a filename into a human-readable title.
 * e.g. "The-7-Best-Habit-Books.pdf" → "The 7 Best Habit Books"
 */
function formatTitle(filename) {
  return filename
    .replace(/\.pdf$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateManifest() {
  // Ensure the Books directory exists
  if (!fs.existsSync(BOOKS_DIR)) {
    console.error(`❌ Error: Directory "${BOOKS_DIR}" not found.`);
    process.exit(1);
  }

  // Read all PDF files
  const files = fs.readdirSync(BOOKS_DIR)
    .filter(f => f.toLowerCase().endsWith('.pdf'))
    .sort();

  if (files.length === 0) {
    console.warn('⚠️  No PDF files found in Books/ directory.');
  }

  // Build the manifest
  const manifest = files.map((file, index) => ({
    title: formatTitle(file),
    file: `Books/${file}`,
    colors: COVER_COLORS[index % COVER_COLORS.length],
  }));

  // Write the JSON file
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(manifest, null, 2), 'utf-8');
  console.log(`✅ Generated books.json with ${manifest.length} book(s):`);
  manifest.forEach(b => console.log(`   📖 ${b.title}`));
}

generateManifest();
