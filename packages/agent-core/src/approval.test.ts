import {describe,it,expect} from 'vitest';
import {fileURLToPath} from 'node:url'; import {initAgent} from './index.js'; import {ExamplePlugin} from '@agent/plugin-example';
const POLICIES_DIR=fileURLToPath(new URL('../../../policies/approval',import.meta.url));

describe('approval gateway',()=>{it('denies blocked email before approval lookup',async()=>{const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir:POLICIES_DIR});await expect(executeTask('send_email',{to:'spam@spam.com'})).rejects.toThrow('Domain spam.com is blocked by policy.')});it('fails closed without a verified approval record',async()=>{const {executeTask}=await initAgent({plugins:[ExamplePlugin],policiesDir:POLICIES_DIR});await expect(executeTask('send_email',{to:'ok@example.com',managerApproval:true})).rejects.toThrow('valid approved approvalId')})});
