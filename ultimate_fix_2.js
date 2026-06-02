const fs = require('fs');

let test = fs.readFileSync('contracts/src/test.rs', 'utf8').replace(/\r\n/g, '\n');

// 1. Remove dangling body of assert_cost_within_tolerance
const dangling_body = `    let cpu_limit = baseline_cpu + (baseline_cpu * BENCHMARK_TOLERANCE_PERCENT / 100);
    let mem_limit = baseline_mem + (baseline_mem * BENCHMARK_TOLERANCE_PERCENT / 100);

    assert!(
        cpu <= cpu_limit,
        "CPU cost {} exceeds tolerance limit {} (baseline: {})",
        cpu,
        cpu_limit,
        baseline_cpu
    );
    assert!(
        mem <= mem_limit,
        "Memory cost {} exceeds tolerance limit {} (baseline: {})",
        mem,
        mem_limit,
        baseline_mem
    );
}`;

test = test.replace(dangling_body, '');
fs.writeFileSync('contracts/src/test.rs', test);


let lib = fs.readFileSync('contracts/src/lib.rs', 'utf8').replace(/\r\n/g, '\n');
// Fix validate_slippage_policy_version defined multiple times
const val_slip = `fn validate_slippage_policy_version(version: u32) -> bool {
    version == CURRENT_SLIPPAGE_POLICY_VERSION
}`;
let firstIndex = lib.indexOf(val_slip);
if (firstIndex !== -1) {
    let secondIndex = lib.indexOf(val_slip, firstIndex + 1);
    if (secondIndex !== -1) {
        lib = lib.substring(0, secondIndex) + lib.substring(secondIndex + val_slip.length);
    }
}
fs.writeFileSync('contracts/src/lib.rs', lib);
