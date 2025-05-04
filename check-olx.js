require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Load config from environment
const URL = process.env.TARGET_URL;
const INTERVAL_SECONDS = parseInt(process.env.INTERVAL_SECONDS || '60');
const STORAGE_FILE = path.resolve(__dirname, 'temp-listings.json');

// Email config
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const EMAIL_TO = process.env.EMAIL_TO;

function loadPreviousListings() {
  if (!fs.existsSync(STORAGE_FILE)) return new Map();
  const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
  return new Map(Object.entries(JSON.parse(raw)));
}

function saveListings(map) {
  fs.writeFileSync(STORAGE_FILE, JSON.stringify(Object.fromEntries(map), null, 2), 'utf-8');
}

function serializeListing(listing) {
  return JSON.stringify({
    title: listing.title,
    price: listing.price,
    condition: listing.condition,
    locationDate: listing.locationDate
  });
}

async function sendEmailNotification(items) {
  const subject = `[OLX Alert] ${items.length} new/updated LEGO 51515 listings`;
  const html = items.map(item => `
    <p>
      <b>[${item.changeType}] ${item.title}</b><br>
      Price: ${item.price}<br>
      Condition: ${item.condition}<br>
      Location: ${item.locationDate}<br>
      <a href="${item.fullLink}">View on OLX</a><br>
      <img src="${item.image}" width="200"/>
    </p><hr/>
  `).join('\n');

  await transporter.sendMail({
    from: `"OLX Monitor" <${transporter.options.auth.user}>`,
    to: EMAIL_TO,
    subject,
    html
  });

  console.log(`Sent email with ${items.length} new/updated listings.`);
}

async function fetchOLXListings() {
  const previousListings = loadPreviousListings();
  const browser = await puppeteer.launch({ 
    headless: true,
    defaultViewport: null,
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(URL, { waitUntil: 'networkidle2' });

  const listings = await page.$$eval('div[data-cy="l-card"]', cards =>
    cards.map(card => {
      const title = card.querySelector('h4')?.innerText.trim() || 'No title';
      const price = card.querySelector('[data-testid="ad-price"]')?.innerText.trim() || 'No price';
      const linkSuffix = card.querySelector('a.css-1tqlkj0')?.getAttribute('href') || '';
      const fullLink = linkSuffix.startsWith('http') ? linkSuffix : `https://www.olx.pl${linkSuffix}`;
      const image = card.querySelector('img')?.getAttribute('src') || '';
      const condition = card.querySelector('[title]')?.innerText.trim() || 'No condition';
      const locationDate = card.querySelector('[data-testid="location-date"]')?.innerText.trim() || 'No location/date';

      return { title, price, fullLink, image, condition, locationDate };
    })
  );

  const updatedMap = new Map();
  const newOrChanged = [];

  for (const item of listings) {
    const key = item.fullLink;
    const serialized = serializeListing(item);
    updatedMap.set(key, serialized);

    if (!previousListings.has(key)) {
      newOrChanged.push({ ...item, changeType: 'New' });
    } else if (previousListings.get(key) !== serialized) {
      newOrChanged.push({ ...item, changeType: 'Updated' });
    }
  }

  if (newOrChanged.length > 0) {
    await sendEmailNotification(newOrChanged);
  } else {
    console.log(`[${new Date().toLocaleTimeString()}] No new or changed listings.`);
  }

  saveListings(updatedMap);
  await browser.close();
}

async function startMonitoring() {
  console.log(`Monitoring: ${URL} every ${INTERVAL_SECONDS} seconds...`);
  await fetchOLXListings();
  setInterval(fetchOLXListings, INTERVAL_SECONDS * 1000);
}

startMonitoring();
