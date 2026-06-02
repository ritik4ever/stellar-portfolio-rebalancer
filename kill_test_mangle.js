const fs = require('fs');

let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

// Find the line that starts with `fn // assert_cost_within_tolerance` and delete it and everything after it.
const searchStr = 'fn // assert_cost_within_tolerance';
const index = test.indexOf(searchStr);
if (index !== -1) {
    test = test.substring(0, index);
}

fs.writeFileSync('contracts/src/test.rs', test);
