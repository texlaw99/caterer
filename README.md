# Caterer Scraper

A Node.js application that scrapes information about caterers in a specified city using Google Maps Platform APIs and creates a Google Spreadsheet with the collected data.

## Features

- Search for caterers in a specified city using Google Places API
- Collect detailed information about each caterer (address, phone, website, etc.)
- Parse addresses into structured components (street, city, state, zip)
- Export all data to a formatted Google Spreadsheet

## Prerequisites

- Node.js installed
- Google Cloud Platform account with the following APIs enabled:
  - Places API
  - Google Sheets API
- Google API key and OAuth credentials (credentials.json)

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   npm install
   ```
3. Create a Google Cloud project and enable the required APIs
4. Create an API key for Places API
5. Create OAuth credentials (credentials.json) for Google Sheets API
6. Update the CONFIG object in caterer-scraper.js with your information

## Usage

Run the script with:

```
node caterer-scraper.js
```

The first time you run the script, it will prompt you to authorize access to your Google account. Follow the instructions to complete the OAuth flow.

## Configuration

Edit the CONFIG object in caterer-scraper.js to customize:

- Target city and state
- Maximum number of results to fetch
- API key
- Output spreadsheet title 