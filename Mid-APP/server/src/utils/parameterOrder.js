// Parameters are shown in their Parameter Master "sequence" (1, 2, 3 ...)
// everywhere - result entry, the printed report, shared/trend reports.
// Parameters without a sequence go after the numbered ones, oldest first.

function seqOf(p) {
  const s = p?.sequence;
  return s == null || s === '' ? Number.MAX_SAFE_INTEGER : Number(s);
}

/** Sorts parameter objects (ParameterMaster rows/JSON) in place by sequence, then id. */
function sortParameters(params) {
  return params.sort((a, b) => seqOf(a) - seqOf(b) || (a.id || 0) - (b.id || 0));
}

/** Sorts Result rows in place by their ParameterMaster's sequence. */
function sortResultsByParameter(results) {
  return results.sort((a, b) => {
    const pa = a.ParameterMaster || {};
    const pb = b.ParameterMaster || {};
    return seqOf(pa) - seqOf(pb) || (pa.id || 0) - (pb.id || 0);
  });
}

module.exports = { sortParameters, sortResultsByParameter };
