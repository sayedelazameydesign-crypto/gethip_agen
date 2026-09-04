import {loadPoliciesFromDir} from '@agent/extension-system';
import {SecurityKernel} from '@agent/security';
import type {ApprovalStore} from '@agent/approval-store';
export class ApprovalGateway {
 constructor(private securityKernel=new SecurityKernel(),private policiesDir='./policies/approval/',private store?:ApprovalStore){}
 async request(level:1|2|3,payload:Record<string,unknown>){
  const policies=await loadPoliciesFromDir(this.policiesDir);
  const policyDecision=this.securityKernel.evaluate({level,payload:{...payload,managerApproval:true},policies});
  if(!policyDecision.approved)return policyDecision;
  if(level>=2){const approvalId=typeof payload.approvalId==='string'?payload.approvalId:'';if(!this.store||!approvalId||!(await this.store.verifyApproved(approvalId)))return {approved:false,reason:'Level 2+ requires a valid approved approvalId.'};}
  return {approved:true};
 }
}
