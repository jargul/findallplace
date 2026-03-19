const axios = require('axios');
const cheerio = require('cheerio');

async function main() {
  try {
    const baseUrl = 'https://www.bavastronline.com.uy';
    const url = 'https://www.bavastronline.com.uy/auctions/';
    console.log('Fetching', url);
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
      }
    });
    const html = response.data;
    const $ = cheerio.load(html);
    
    // find all links that look like auctions
    const auctionLinks = [];
    $('a').each((i, el) => {
      const href = $(el).attr('href');
      if (href && href.includes('/auctions/')) {
        auctionLinks.push(href);
      }
    });
    
    console.log('Found auction links:', [...new Set(auctionLinks)].slice(0, 5));
    
    if (auctionLinks.length > 0) {
        const firstAuction = auctionLinks[0];
        const auctionUrl = firstAuction.startsWith('http') ? firstAuction : baseUrl + firstAuction;
        console.log('Fetching first auction:', auctionUrl);
        const res2 = await axios.get(auctionUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36'
            }
        });
        const $2 = cheerio.load(res2.data);
        console.log('Title:', $2('title').text());
        
        // Find items
        // Usually lots have links containing '/lot/'
        const lotLinks = [];
        $2('a').each((i, el) => {
            const href = $2(el).attr('href');
            if (href && href.includes('/lot/')) {
                lotLinks.push(href);
                // Check the parent container element to see classes
                if (lotLinks.length === 1) {
                    console.log('Sample lot link HTML:', $2(el).parent().html());
                    console.log('Parent classes:', $2(el).parent().attr('class'));
                }
            }
        });
        console.log('Found lot links:', [...new Set(lotLinks)].length);
    }
    
  } catch (error) {
    console.error('Error fetching:', error.message);
  }
}
main();
