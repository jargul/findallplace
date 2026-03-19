const axios = require('axios');

async function main() {
  try {
    console.log('Fetching Castells home...');
    const homeRes = await axios.get('https://subastascastells.com/frontend.home.aspx', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });
    
    const html = homeRes.data;
    
    // Look for AV9SubastasEnProgreso or vSUBASTASENPROGRESO
    const match = html.match(/"vSUBASTASENPROGRESO":(\[.+?\])/);
    if (match && match[1]) {
        try {
            const parsed = JSON.parse(match[1]);
            console.log('Successfully extracted active auctions!');
            console.log('Auctions count:', parsed.length);
            
            if (parsed.length > 0) {
                // Print the first one to see its structure
                console.log('First auction structure:', JSON.stringify(parsed[0], null, 2));
                
                // Usually the ID is something like Remateid
                const testId = parsed[0].Remateid;
                if (testId) {
                    console.log(`Testing API for auction ${testId}...`);
                    const lotsUrl = `https://subastascastells.com/rest/API/Remate/lotes?Remateid=${testId}&RemateTipo=1&Cerrado=false`;
                    const lotsRes = await axios.get(lotsUrl);
                    console.log(`API returned ${lotsRes.data.length} lots.`);
                    if (lotsRes.data.length > 0) {
                        console.log('Sample lot:', JSON.stringify(lotsRes.data[0], null, 2));
                    }
                } else {
                    console.log('No Remateid found in object');
                }
            }
        } catch (e) {
            console.error('Failed to parse JSON:', e.message);
            console.log('Raw match:', match[1].substring(0, 200));
        }
    } else {
        console.log('Could not find vSUBASTASENPROGRESO in HTML');
        // Try another regex if the first fails
        const alternative = html.match(/AV9SubastasEnProgreso(.*?)\]/);
        if (alternative) console.log('Found alternative:', alternative[0].substring(0, 100));
    }
  } catch (err) {
      console.error(err.message);
  }
}
main();
