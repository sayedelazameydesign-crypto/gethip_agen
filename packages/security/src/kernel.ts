export type ApprovalRequest={level:1|2|3;payload:Record<string,unknown>;policies:Record<string,unknown>};
export class SecurityKernel {
 evaluate(request:ApprovalRequest):{approved:boolean;reason?:string}{
  const all=Object.values(request.policies).filter(v=>v&&typeof v==='object') as Record<string,unknown>[];
  const blocked=all.flatMap(v=>Array.isArray(v.blockedDomains)?v.blockedDomains:[]).map(String);
  const address=typeof request.payload.to==='string'?request.payload.to:''; const domain=address.split('@')[1]?.toLowerCase();
  if(domain && blocked.includes(domain)) return {approved:false,reason:`Domain ${domain} is blocked by policy.`};
  if(request.level>=2 && request.payload.managerApproval!==true) return {approved:false,reason:'Level 2+ requires manager approval flag.'};
  return {approved:true};
 }
}
