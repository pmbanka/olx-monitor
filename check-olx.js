require('dotenv').config();
const puppeteer = require('puppeteer');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const INTERVAL_SECONDS = parseInt(process.env.INTERVAL_SECONDS || '360', 10);
const URLS = process.env.OLX_URLS?.split(',')
  .map(url => url.trim())
  .filter(Boolean)
  .map(url => {
    try {
      return new URL(url).href;
    } catch (err) {
      console.warn(`Invalid URL skipped: ${url}`);
      return null;
    }
  })
  .filter(Boolean);

if (URLS.length === 0) {
  console.error('No valid OLX_URLS defined in .env');
  process.exit(1);
}

const EMAIL_CONFIG = {
  host: process.env.EMAIL_HOST,
  port: Number(process.env.EMAIL_PORT),
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
};
const EMAIL_TO = process.env.EMAIL_TO;
if (!EMAIL_TO) {
  console.error('EMAIL_TO not defined in .env');
  process.exit(1);
}

const listingsDir = path.join(__dirname, 'listings');
if (!fs.existsSync(listingsDir)) fs.mkdirSync(listingsDir);

// Helpers
const sanitizeUrlToFile = url => Buffer.from(url).toString('base64') + '.json';
const getStorageFileForUrl = url => path.join(listingsDir, sanitizeUrlToFile(url));
const serializeListing = item => JSON.stringify([item.title, item.price, item.condition, item.locationDate]);

const loadPreviousListings = file => {
  try {
    return new Map(JSON.parse(fs.readFileSync(file)));
  } catch (e) {
    return new Map();
  }
};

const saveListings = (map, file) => {
  const data = [...map.entries()];
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

const sendEmailNotification = async items => {
  const grouped = items.reduce((acc, item) => {
    acc[item.sourceUrl] = acc[item.sourceUrl] || [];
    acc[item.sourceUrl].push(item);
    return acc;
  }, {});

  let html = '<h1>OLX New or Changed Listings</h1>';
  for (const [url, group] of Object.entries(grouped)) {
    html += `<h2><a href="${url}">${url}</a></h2>`;
    html += group.map(item => `
      <p>
        <b>[${item.changeType}] ${item.title}</b><br>
        Price: ${item.price}<br>
        Condition: ${item.condition}<br>
        Location: ${item.locationDate}<br>
        <a href="${item.fullLink}">View on OLX</a><br>
        <img src="${item.image}" width="200"/>
      </p><hr/>
    `).join('\n');
  }

  const transporter = nodemailer.createTransport(EMAIL_CONFIG);
  await transporter.sendMail({
    from: `"OLX Monitor" <${transporter.options.auth.user}>`,
    to: EMAIL_TO,
    subject: `[OLX Alert] ${items.length} new/updated listing(s)`,
    html
  });

  console.log(`Email sent with ${items.length} listing(s).`);
};

let browser = null;
let shuttingDown = false;

const scrapeUrl = async (url) => {
  const file = getStorageFileForUrl(url);
  const previousListings = loadPreviousListings(file);

  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });

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

  await page.close();

  const updatedMap = new Map();
  const newOrChanged = [];

  for (const item of listings) {
    const key = item.fullLink;
    const serialized = serializeListing(item);
    updatedMap.set(key, serialized);

    if (!previousListings.has(key)) {
      newOrChanged.push({ ...item, changeType: 'New', sourceUrl: url });
    } else if (previousListings.get(key) !== serialized) {
      newOrChanged.push({ ...item, changeType: 'Updated', sourceUrl: url });
    }
  }

  saveListings(updatedMap, file);
  return newOrChanged;
};

const runCycle = async () => {
  if (shuttingDown) return;

  try {
    const allChanges = [];

    for (const url of URLS) {
      const changes = await scrapeUrl(url);
      if (changes.length > 0) {
        console.log(`${url} → ${changes.length} new/updated`);
        allChanges.push(...changes);
      } else {
        console.log(`${url} → No changes`);
      }
    }

    if (allChanges.length > 0) {
      await sendEmailNotification(allChanges);
    }
  } catch (err) {
    console.error('Error during cycle:', err);
  }
};

const startMonitoring = async () => {
  console.log(`Monitoring ${URLS.length} URL(s) every ${INTERVAL_SECONDS} seconds`);

  browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: null,
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox'],
  });

  await runCycle();
  const intervalId = setInterval(runCycle, INTERVAL_SECONDS * 1000);

  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Gracefully shutting down...');
    clearInterval(intervalId);
    if (browser) await browser.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

startMonitoring();
