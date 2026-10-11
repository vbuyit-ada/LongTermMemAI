const MIN_FUZZY_MATCH_LENGTH = 20;
const FUZZY_MATCH_THRESHOLD = 0.9;

function normalizeMemoryText(text) {
    return text.normalize('NFKC')
        .toLowerCase()
        .replace(/[\p{P}\p{Z}\s]/gu, '');
}

function getBigrams(text) {
    const bigrams = new Set();
    const characters = Array.from(text);
    for (let index = 0; index < characters.length - 1; index++) {
        bigrams.add(characters.slice(index, index + 2).join(''));
    }
    return bigrams;
}

function getPolarityMarkers(text) {
    const pattern = /\b(?:no\s+longer|without|never|dislike[ds]?|hate[ds]?|avoid(?:s|ed)?|stop(?:ped)?|no|not)\b|不再|不喜歡|不喜欢|討厭|讨厌|不是|不會|不会|不要|不|沒|没|無|无|非|未/gu;
    return new Set(text.toLowerCase().match(pattern) || []);
}

function hasSamePolarityMarkers(left, right) {
    const leftMarkers = getPolarityMarkers(left);
    const rightMarkers = getPolarityMarkers(right);
    return leftMarkers.size === rightMarkers.size
        && [...leftMarkers].every(marker => rightMarkers.has(marker));
}

function isLikelyDuplicate(candidate, existing) {
    const normalizedCandidate = normalizeMemoryText(candidate);
    const normalizedExisting = normalizeMemoryText(existing);

    if (normalizedCandidate === normalizedExisting) return true;
    if (Array.from(normalizedCandidate).length < MIN_FUZZY_MATCH_LENGTH
        || Array.from(normalizedExisting).length < MIN_FUZZY_MATCH_LENGTH
        || !hasSamePolarityMarkers(candidate, existing)) {
        return false;
    }

    const candidateBigrams = getBigrams(normalizedCandidate);
    const existingBigrams = getBigrams(normalizedExisting);
    let sharedBigrams = 0;

    for (const bigram of candidateBigrams) {
        if (existingBigrams.has(bigram)) sharedBigrams++;
    }

    const similarity = (2 * sharedBigrams) / (candidateBigrams.size + existingBigrams.size);
    return similarity >= FUZZY_MATCH_THRESHOLD;
}

module.exports = { isLikelyDuplicate };
