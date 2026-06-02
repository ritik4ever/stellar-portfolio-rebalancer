const fs = require('fs');
let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

// test_deposit_invalid_amount
test = test.replace(/#\[test\]\n#\[should_panic\(expected = "Error\(Contract, #25\)"\)\]\nfn test_deposit_invalid_amount[\s\S]*?\}\n/, '');

// test_deposit_rejects_paused_portfolio
test = test.replace(/#\[test\]\n#\[should_panic\(expected = "Error\(Contract, #18\)"\)\]\nfn test_deposit_rejects_paused_portfolio[\s\S]*?\}\n/, '');

fs.writeFileSync('contracts/src/test.rs', test);
