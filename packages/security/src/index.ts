import type {ToolRequest} from '@agent/contracts';
const level0=['repo.list','repo.get','file.read','search.code','git.status','git.diff','git.log','test.run','github.issue.list','github.pr.list','github.checks.get'];
const level1=['file.write','file.delete','git.branch.create','git.commit','command.run','github.pr.create','github.pr.comment'];
export type Decision={allowed:boolean;requiresApproval:boolean;reason:string};
export function evaluateTool(tool:ToolRequest):Decision {
 if(level0.includes(tool.name)) return {allowed:true,requiresApproval:false,reason:'قراءة آمنة تلقائيًا'};
 if(level1.includes(tool.name)) return {allowed:true,requiresApproval:true,reason:'يتطلب موافقة Level 1'};
 return {allowed:false,requiresApproval:false,reason:'الأداة غير مسجلة أو محظورة افتراضيًا'};
}
