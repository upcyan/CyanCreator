import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsExtras} from '../public/settings-extra.js';

test('保险库锁定时只提供恢复入口，解除锁定后才提供密钥录入',()=>{
  const state={settings:{text:{profiles:[{keyEnv:'IMAGE_API_KEY'}]}},secrets:[],vault:{sealed:true,error:'无法解密'}};
  const locked=settingsExtras(state);
  assert.match(locked,/密钥保险库已锁定/);
  assert.match(locked,/data-action="vault-reset-open"/);
  assert.doesNotMatch(locked,/data-action="secret-save"|data-pending-key|id="secret-value"/);
  state.vault.sealed=false;
  const ready=settingsExtras(state);
  assert.match(ready,/data-action="secret-save"/);
  assert.match(ready,/data-pending-key="IMAGE_API_KEY"/);
});
