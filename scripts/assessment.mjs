export function assessmentIdentity(value) {
  const target = value?.target;
  if (target !== undefined) {
    if (value.pr !== undefined || !target || Object.keys(target).some(k => !['kind','name','platform','artifactSha256'].includes(k)) || !['build','release'].includes(target.kind) || !['web','api','android','ios','macos','windows','linux'].includes(target.platform) || typeof target.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._+:/-]{0,119}$/.test(target.name) || !/^[a-f0-9]{64}$/.test(target.artifactSha256 || '')) throw new Error('Invalid build/release identity');
    return { target: { kind: target.kind, name: target.name, platform: target.platform, artifactSha256: target.artifactSha256 } };
  }
  if (!Number.isSafeInteger(value?.pr?.number) || value.pr.number < 1) throw new Error('A real PR or exact build/release identity is required');
  return { pr: { number: value.pr.number } };
}
export function sameAssessment(left, right) { try { return JSON.stringify(assessmentIdentity(left)) === JSON.stringify(assessmentIdentity(right)); } catch { return false; } }
