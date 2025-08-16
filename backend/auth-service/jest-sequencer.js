const Sequencer = require('@jest/test-sequencer').default;

class CustomSequencer extends Sequencer {
  sort(tests) {
    // Run unit tests first, then integration tests
    const testOrder = [
      'crypto.test.ts',
      'otpService.test.ts', 
      'auth.test.ts'
    ];
    
    return tests.sort((testA, testB) => {
      const aIndex = testOrder.findIndex(name => testA.path.includes(name));
      const bIndex = testOrder.findIndex(name => testB.path.includes(name));
      
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
      }
      
      if (aIndex !== -1) return -1;
      if (bIndex !== -1) return 1;
      
      return testA.path.localeCompare(testB.path);
    });
  }
}

module.exports = CustomSequencer;