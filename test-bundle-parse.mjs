import { parseConfigBundle } from './dist/shared/configBundle.js';

// Test 1: Can we inject __proto__?
const testProto = JSON.stringify({
  version: 1,
  exportedAt: 0,
  common: {
    "__proto__": { polluted: true },
    "cafeId": "31068798",
    "cafeUrlName": "whiskyclub",
    "operatorAccounts": []
  },
  automations: []
});

try {
  const result = parseConfigBundle(testProto);
  if (result.ok) {
    console.log('Test 1 - Proto injection: PASSED - result is', JSON.stringify(result.bundle.common));
  }
} catch (e) {
  console.log('Test 1 error:', e.message);
}

// Test 2: Null exportedAt
const testNull = JSON.stringify({
  version: 1,
  exportedAt: null,
  common: {
    "cafeId": "31068798",
    "cafeUrlName": "whiskyclub",
    "operatorAccounts": []
  },
  automations: []
});

try {
  const result = parseConfigBundle(testNull);
  if (result.ok) {
    console.log('Test 2 - Null exportedAt:', result.bundle.exportedAt);
  }
} catch (e) {
  console.log('Test 2 error:', e.message);
}
