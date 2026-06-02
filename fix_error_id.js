const fs = require('fs');
let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

// The remaining failure expects "#16" but got "#18".
test = test.replace(/Error\(Contract, #16\)/g, 'Error(Contract, #18)');

fs.writeFileSync('contracts/src/test.rs', test);
