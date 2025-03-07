const { google } = require('googleapis');
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const readline = require('readline');
// Load environment variables from .env file
require('dotenv').config();

// Configuration
const CONFIG = {
  city: 'Portland', // Replace with your target city
  state: 'ME', // Add state code to distinguish between cities with same name (e.g., OR for Oregon, ME for Maine)
  maxResults: 100, // Maximum number of results to fetch
  googleApiKey: process.env.GOOGLE_API_KEY || '', // Load from environment variable
  credentialsPath: './credentials.json', // Make sure this matches your file name
  tokenPath: './token.json', // This will be created automatically
  sheetTitle: 'Caterers in Portland, OR', // Title for the Google Sheet
};

// Scopes required for Google Docs and Sheets
const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets'
];

/**
 * Get and store new token after prompting for user authorization
 */
async function getNewToken(oAuth2Client) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });
  
  console.log('Authorize this app by visiting this URL:', authUrl);
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  
  return new Promise((resolve) => {
    rl.question('Enter the code from that page here: ', (code) => {
      rl.close();
      oAuth2Client.getToken(code, (err, token) => {
        if (err) {
          console.error('Error retrieving access token', err);
          return;
        }
        oAuth2Client.setCredentials(token);
        // Store the token to disk for later program executions
        fs.writeFileSync(CONFIG.tokenPath, JSON.stringify(token));
        console.log('Token stored to', CONFIG.tokenPath);
        resolve(oAuth2Client);
      });
    });
  });
}

/**
 * Create an OAuth2 client with the given credentials
 */
async function authorize() {
  const credentials = JSON.parse(fs.readFileSync(CONFIG.credentialsPath));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);

  // Check if we have a token stored
  try {
    if (fs.existsSync(CONFIG.tokenPath)) {
      const token = JSON.parse(fs.readFileSync(CONFIG.tokenPath));
      oAuth2Client.setCredentials(token);
      return oAuth2Client;
    } else {
      return getNewToken(oAuth2Client);
    }
  } catch (error) {
    console.error('Error loading token:', error);
    return getNewToken(oAuth2Client);
  }
}

/**
 * Search for caterers using Google Places API
 */
async function searchForCaterers() {
  try {
    const { default: fetch } = await import('node-fetch');
    
    // Encode the query for URL with both city and state for precision
    const query = encodeURIComponent(`caterers in ${CONFIG.city}, ${CONFIG.state}`);
    
    // Start with null pagetoken (first page)
    let pagetoken = null;
    let allResults = [];
    let totalFetched = 0;
    
    do {
      // Build the URL with pagetoken if it exists
      let url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&type=food&key=${CONFIG.googleApiKey}`;
      if (pagetoken) {
        url += `&pagetoken=${pagetoken}`;
        // API requires a short delay when using page tokens
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Make the request
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status !== 'OK') {
        throw new Error(`API returned error: ${data.status} - ${data.error_message || 'Unknown error'}`);
      }
      
      // Add results to our collection
      allResults = allResults.concat(data.results);
      totalFetched += data.results.length;
      
      // Get next page token if it exists and we haven't reached maxResults
      pagetoken = (data.next_page_token && totalFetched < CONFIG.maxResults) ? data.next_page_token : null;
      
      console.log(`Fetched ${data.results.length} results. Total: ${totalFetched}`);
      
    } while (pagetoken && totalFetched < CONFIG.maxResults);
    
    // Process and filter the results
    const processedResults = allResults.map(place => {
      // Parse the address components
      const addressParts = parseAddress(place.formatted_address);
      
      return {
        name: place.name,
        fullAddress: place.formatted_address,
        street: addressParts.street,
        city: addressParts.city,
        state: addressParts.state,
        zip: addressParts.zip,
        rating: place.rating || 'No rating',
        totalRatings: place.user_ratings_total || 0,
        placeId: place.place_id,
        location: place.geometry.location,
      };
    });
    
    return processedResults;
  } catch (error) {
    console.error('Error searching for caterers:', error);
    throw error;
  }
}

/**
 * Check if a caterer has wedding-related reviews
 */
function checkForWeddingReviews(reviews) {
  if (!reviews || !Array.isArray(reviews)) {
    return { hasWeddingReviews: false, weddingReviewCount: 0 };
  }
  
  // Count reviews that mention "wedding"
  const weddingReviews = reviews.filter(review => 
    review.text && review.text.toLowerCase().includes('wedding')
  );
  
  return {
    hasWeddingReviews: weddingReviews.length >= 2,
    weddingReviewCount: weddingReviews.length
  };
}

/**
 * Parse an address string into components
 */
function parseAddress(addressStr) {
  try {
    // Remove USA or country name from the end
    let addressText = addressStr;
    if (addressText.endsWith(', USA')) {
      addressText = addressText.slice(0, -5);
    }
    
    // Split by commas
    const parts = addressText.split(',').map(part => part.trim());
    
    // Last part should contain state and zip
    const lastPart = parts[parts.length - 1];
    const lastPartTokens = lastPart.split(' ').filter(Boolean);
    
    // Look for zip code in the last part
    let zip = '';
    let stateZip = [...lastPartTokens];
    
    // Assuming zip code is a 5 digit number
    for (let i = 0; i < lastPartTokens.length; i++) {
      if (/^\d{5}(-\d{4})?$/.test(lastPartTokens[i])) {
        zip = lastPartTokens[i];
        stateZip = lastPartTokens.slice(0, i);
        break;
      }
    }
    
    const state = stateZip.join(' '); // Remaining is state
    
    // Second to last part should be city
    const city = parts.length > 1 ? parts[parts.length - 2] : '';
    
    // First part(s) should be street address (could be multiple parts)
    const street = parts.slice(0, parts.length - 2).join(', ');
    
    return {
      street,
      city,
      state,
      zip
    };
  } catch (error) {
    console.warn(`Error parsing address: ${addressStr}`, error);
    return {
      street: addressStr,
      city: '',
      state: '',
      zip: ''
    };
  }
}

/**
 * Get additional details for a place using Place Details API
 * Enhanced to fetch up to 20 reviews by making multiple requests with different sort orders
 */
async function getPlaceDetails(placeId) {
  try {
    const { default: fetch } = await import('node-fetch');
    
    // We'll make 4 separate requests to get up to 20 reviews (5 per request)
    // Using different sort orders to try to get different reviews
    const sortOptions = [
      'most_relevant', // Default sort
      'newest',       // Newest reviews
      'highest',      // Highest rating first
      'lowest'        // Lowest rating first
    ];
    
    let allReviews = [];
    let details = null;
    
    for (const sortOption of sortOptions) {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website,price_level,reviews&reviewsort=${sortOption}&key=${CONFIG.googleApiKey}`;
      
      const response = await fetch(url);
      const data = await response.json();
      
      if (data.status !== 'OK') {
        console.warn(`Warning: Could not get details for place ${placeId} with sort ${sortOption}: ${data.status}`);
        continue;
      }
      
      // Store full details from the first request
      if (!details) {
        details = data.result;
      }
      
      // Add new reviews that aren't duplicates
      if (data.result.reviews && Array.isArray(data.result.reviews)) {
        // Use a Set to track review IDs we've already seen
        const existingReviewIds = new Set(allReviews.map(r => r.time + r.author_name));
        
        data.result.reviews.forEach(review => {
          const reviewId = review.time + review.author_name;
          if (!existingReviewIds.has(reviewId)) {
            allReviews.push(review);
            existingReviewIds.add(reviewId);
          }
        });
      }
      
      // Respect API rate limits with a small delay
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    
    // Cap at 20 reviews max and update the details object
    if (allReviews.length > 0) {
      allReviews = allReviews.slice(0, 20);
      if (details) {
        details.reviews = allReviews;
      }
    }
    
    return details;
  } catch (error) {
    console.error(`Error getting details for place ${placeId}:`, error);
    return null;
  }
}

/**
 * Enrich caterer data with additional details
 */
async function enrichCatererData(caterers) {
  console.log('Enriching caterer data with additional details...');
  const enrichedCaterers = [];
  
  for (let i = 0; i < caterers.length; i++) {
    console.log(`Processing caterer ${i + 1} of ${caterers.length}: ${caterers[i].name}`);
    
    const details = await getPlaceDetails(caterers[i].placeId);
    
    // Create a Google Maps URL using place_id
    const mapsUrl = `https://www.google.com/maps/place/?q=place_id:${caterers[i].placeId}`;
    
    if (details) {
      // Check for wedding-related reviews
      const weddingReviewInfo = checkForWeddingReviews(details.reviews);
      
      enrichedCaterers.push({
        ...caterers[i],
        phoneNumber: details.formatted_phone_number || 'No phone number',
        website: details.website || 'No website',
        mapsUrl: mapsUrl,
        priceLevel: details.price_level ? '$'.repeat(details.price_level) : 'Unknown',
        // Add wedding review information
        hasWeddingReviews: weddingReviewInfo.hasWeddingReviews,
        weddingReviewCount: weddingReviewInfo.weddingReviewCount,
        // Store the total number of reviews we found
        reviewCount: details.reviews ? details.reviews.length : 0
      });
    } else {
      enrichedCaterers.push({
        ...caterers[i],
        phoneNumber: 'No phone number',
        website: 'No website',
        mapsUrl: mapsUrl,
        priceLevel: 'Unknown',
        hasWeddingReviews: false,
        weddingReviewCount: 0,
        reviewCount: 0
      });
    }
    
    // Add a small delay to avoid hitting API rate limits
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  return enrichedCaterers;
}
/**
 * Create a Google Sheet and add caterer information
 */
async function createGoogleSheet(auth, caterers) {
  const sheets = google.sheets({ version: 'v4', auth });
  
  try {
    console.log('Creating Google Sheet...');
    
    // Create a new spreadsheet
    const createResponse = await sheets.spreadsheets.create({
      requestBody: {
        properties: {
          title: CONFIG.sheetTitle,
        },
        sheets: [
          {
            properties: {
              title: 'Caterers',
            },
          },
        ],
      },
    });
    
    const spreadsheetId = createResponse.data.spreadsheetId;
    console.log(`Created spreadsheet with ID: ${spreadsheetId}`);
    
    // Get the actual sheet ID (different from spreadsheet ID)
    const getResponse = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId
    });
    
    const sheetId = getResponse.data.sheets[0].properties.sheetId;
    
    // Define the column headers
    const headers = [
      'Name', 'Street Address', 'City', 'State', 'Zip', 
      'Phone', 'Website', 'Maps URL', 'Rating', 'Reviews', 'Price Level',
      'Wedding Reviews', 'Wedding Caterer'
    ];
    
    // Prepare rows with caterer data
    const rows = caterers.map(caterer => [
      caterer.name,
      caterer.street,
      caterer.city,
      caterer.state,
      caterer.zip,
      caterer.phoneNumber,
      caterer.website,
      caterer.mapsUrl,
      typeof caterer.rating === 'number' ? caterer.rating.toString() : caterer.rating,
      caterer.totalRatings || 0,
      caterer.priceLevel,
      caterer.weddingReviewCount || 0,
      caterer.hasWeddingReviews ? 'Yes' : 'No'
    ]);
    
    // Insert headers and data
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Caterers!A1:M1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [headers]
      }
    });
    
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `Caterers!A2:M${rows.length + 1}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: rows
      }
    });
    
    // Format the header row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            repeatCell: {
              range: {
                sheetId: sheetId, // Use the actual sheet ID we retrieved
                startRowIndex: 0,
                endRowIndex: 1,
              },
              cell: {
                userEnteredFormat: {
                  backgroundColor: {
                    red: 0.8,
                    green: 0.8,
                    blue: 0.8,
                  },
                  horizontalAlignment: 'CENTER',
                  textFormat: {
                    bold: true
                  }
                }
              },
              fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)'
            }
          },
          {
            autoResizeDimensions: {
              dimensions: {
                sheetId: sheetId, // Use the actual sheet ID here too
                dimension: 'COLUMNS',
                startIndex: 0,
                endIndex: 13
              }
            }
          }
        ]
      }
    });
    
    console.log(`Spreadsheet successfully updated: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
    return spreadsheetId;
  } catch (error) {
    console.error('Error creating Google Sheet:', error);
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Searching for caterers...');
    const caterers = await searchForCaterers();
    console.log(`Found ${caterers.length} caterers.`);
    
    if (caterers.length === 0) {
      console.log('No caterers found. Exiting.');
      return;
    }
    
    console.log('Getting additional details...');
    const enrichedCaterers = await enrichCatererData(caterers);
    
    console.log('Authorizing with Google...');
    const auth = await authorize();
    
    console.log('Creating Google Sheet...');
    const spreadsheetId = await createGoogleSheet(auth, enrichedCaterers);
    
    console.log('\nProcess completed successfully!');
    console.log(`View your spreadsheet at: https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`);
  } catch (error) {
    console.error('An error occurred:', error);
  }
}

// Run the script
main();