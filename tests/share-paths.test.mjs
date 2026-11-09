import test from 'node:test';
import assert from 'node:assert/strict';
import { sharePaths, isServiceShare } from '../src/ui/share-paths.ts';

test('share paths use the share name, not its Linux mount directory',()=>{
 const p=sharePaths('192.168.1.10','Archives');
 assert.equal(p.windows,'\\\\192.168.1.10\\Archives');
 assert.equal(p.smb,'smb://192.168.1.10/Archives');
 assert.equal(p.source,'//192.168.1.10/Archives');
 assert.ok(p.command.includes('username=VOTRE_COMPTE_SAMBA'));
 assert.ok(!p.command.includes('password='));
});
test('SMB URLs encode spaces, accents and URL delimiters',()=>{
 const p=sharePaths('nas.example.lan','Photos été #1%');
 assert.equal(p.smb,'smb://nas.example.lan/Photos%20%C3%A9t%C3%A9%20%231%25');
 assert.equal(p.windows,'\\\\nas.example.lan\\Photos été #1%');
 assert.equal(p.localPath,'/mnt/photos-ete-1');
});
test('Linux commands quote remote names and reject option injection in usernames',()=>{
 const p=sharePaths('192.168.1.10',"x'; touch /tmp/pwn; #",'normal-user');
 assert.ok(p.command.includes("'\"'\"'"));
 assert.equal(sharePaths('192.168.1.10','docs','user,password=bad').command,null);
 assert.equal(sharePaths('192.168.1.10','docs','user\nother').command,null);
});
test('IPv6 authorities and Windows IPv6 literals use their client syntax',()=>{
 const p=sharePaths('2001:db8::1','docs');
 assert.equal(p.smb,'smb://[2001:db8::1]/docs');
 assert.equal(p.windows,'\\\\2001-db8--1.ipv6-literal.net\\docs');
});
test('technical shares remain distinguishable from normal data shares',()=>{
 assert.equal(isServiceShare({name:'printers'}),true);
 assert.equal(isServiceShare({name:'print$'}),true);
 assert.equal(isServiceShare({name:'Docs'}),false);
});
