const fs = require('fs');
let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

// Find the last index of `}`
const lastBraceIndex = test.lastIndexOf('}');
if (lastBraceIndex !== -1) {
    test = test.substring(0, lastBraceIndex) + test.substring(lastBraceIndex + 1);
}

fs.writeFileSync('contracts/src/test.rs', test);
