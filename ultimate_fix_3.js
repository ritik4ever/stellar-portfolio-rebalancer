const fs = require('fs');

let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

// The dangling body of assert_cost_within_tolerance
const cpu_limit_index = test.indexOf('let cpu_limit = baseline_cpu');
if (cpu_limit_index !== -1) {
    const end_index = test.indexOf('}', cpu_limit_index);
    if (end_index !== -1) {
        // Find the start of the line with cpu_limit
        const start_index = test.lastIndexOf('\n', cpu_limit_index);
        test = test.substring(0, start_index) + test.substring(end_index + 1);
    }
}
fs.writeFileSync('contracts/src/test.rs', test);


let lib = fs.readFileSync('contracts/src/lib.rs', 'utf8').replace(/\r\n/g, '\n');
const val_slip = `fn validate_slippage_policy_version`;
let firstIndex = lib.indexOf(val_slip);
if (firstIndex !== -1) {
    let secondIndex = lib.indexOf(val_slip, firstIndex + 1);
    if (secondIndex !== -1) {
        const end_index = lib.indexOf('}', secondIndex);
        if (end_index !== -1) {
            const start_index = lib.lastIndexOf('\n', secondIndex);
            lib = lib.substring(0, start_index) + lib.substring(end_index + 1);
        }
    }
}
fs.writeFileSync('contracts/src/lib.rs', lib);
