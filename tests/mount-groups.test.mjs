import test from 'node:test';
import assert from 'node:assert/strict';
import { mountCategory, groupMounts } from '../src/ui/mount-groups.ts';

const mount=(target,source,fstype='ext4',technical=false)=>({target,source,fstype,technical,deviceId:'',fsroot:'/',total:100,used:20,available:80,reserved:0,readOnly:false,pool:null});
test('Linux system mounts stay separate from storage regardless of filesystem',()=>{
 for(const target of ['/','/boot','/boot/efi','/var','/var/log','/home']) assert.equal(mountCategory(mount(target,'/dev/system')), 'system');
 assert.equal(mountCategory(mount('/','rpool/ROOT','zfs')), 'system');
});
test('RAID, ZFS, network and local storage have distinct categories',()=>{
 assert.equal(mountCategory(mount('/mnt/raid','/dev/md0')), 'raid');
 assert.equal(mountCategory(mount('/mnt/archive','/dev/md/archive')), 'raid');
 assert.equal(mountCategory(mount('/mnt/Archives','Archives','zfs')), 'zfs');
 assert.equal(mountCategory(mount('/mnt/backup','nas:/backup','nfs4')), 'network');
 assert.equal(mountCategory(mount('/media/usb','/dev/sdh1')), 'local');
 assert.equal(mountCategory(mount('/run','tmpfs','tmpfs',true)), 'technical');
});
test('each mount appears once and Linux group starts collapsed',()=>{
 const input=[mount('/','/dev/system'),mount('/boot','/dev/sda1'),mount('/mnt/raid','/dev/md0'),mount('/mnt/Archives','Archives','zfs')];
 const groups=groupMounts(input);assert.equal(groups.flatMap(group=>group.mounts).length,input.length);
 assert.deepEqual(groups.map(group=>group.id),['raid','zfs','system']);
 assert.equal(groups.find(group=>group.id==='system').expanded,false);
 assert.equal(groups.find(group=>group.id==='system').mounts.length,2);
});
