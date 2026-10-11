const assert = require('node:assert/strict');
const { isLikelyDuplicate } = require('./memory-deduplication');

assert.equal(
    isLikelyDuplicate('User enjoys weekend hikes.', 'USER enjoys weekend hikes!'),
    true,
    'case and punctuation differences should still match'
);
assert.equal(
    isLikelyDuplicate(
        'User enjoys weekend hiking trips with friends.',
        'User enjoys weekend hiking trips with close friends.'
    ),
    true,
    'minor textual edits should match'
);
assert.equal(
    isLikelyDuplicate('User enjoys weekend hiking trips with friends.', 'User avoids weekend hiking trips with friends.'),
    false,
    'a changed polarity marker should not be treated as a duplicate'
);
assert.equal(
    isLikelyDuplicate('User enjoys hiking.', 'User enjoys biking.'),
    false,
    'different short memories should not fuzzy-match'
);
assert.equal(
    isLikelyDuplicate('User enjoys hiking.', 'USER enjoys hiking!'),
    true,
    'exact normalized short memories should match'
);

console.log('Memory deduplication checks passed.');
