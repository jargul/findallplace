const axios = require('axios');

async function main() {
  try {
    const auctionId = 2813;
    console.log(`Fetching auction info for ${auctionId}...`);
    
    // 1. Get auction status
    const infoUrl = `https://api-parseo.bavastronline.com/published_auctions/${auctionId}/`;
    const infoRes = await axios.get(infoUrl);
    console.log('Auction Info:', JSON.stringify(infoRes.data, null, 2));
    
    // 2. Get lots
    const lotsUrl = `https://api-parseo.bavastronline.com/auctions/${auctionId}/lots/published/?page=1&sort=lot_number&page_size=5`;
    const lotsRes = await axios.get(lotsUrl);
    console.log(`Found ${lotsRes.data.count} lots.`);
    console.log('Sample lot:', JSON.stringify(lotsRes.data.results[0], null, 2));
    
  } catch (err) {
    if (err.response) {
        console.error('API Error:', err.response.status, err.response.data);
    } else {
        console.error('Network Error:', err.message);
    }
  }
}
main();
