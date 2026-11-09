"""Linux-only contained tests. No NAS files or Samba services are changed."""
import importlib.util
import pathlib
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('helper', pathlib.Path(__file__).with_name('samba-manager-helper.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class HelperTest(unittest.TestCase):
    def test_share_mount_uses_longest_path_and_directory_boundary(self):
        mounts=[{'target':'/'},{'target':'/mnt/raid'},{'target':'/mnt/raid/photos'}]
        self.assertEqual(helper.share_mount('/mnt/raid/photos/2026',mounts)['target'],'/mnt/raid/photos')
        self.assertEqual(helper.share_mount('/mnt/raid-other',mounts)['target'],'/')
        self.assertIsNone(helper.share_mount('',mounts))

    def test_storage_keeps_shared_zfs_available_separate_and_deduplicates_raid(self):
        mountdata={'filesystems':[
            {'target':'/','source':'/dev/root','fstype':'ext4','size':1000,'used':400,'avail':500,'options':'rw','fsroot':'/'},
            {'target':'/tank','source':'tank','fstype':'zfs','size':800,'used':100,'avail':700,'options':'rw','fsroot':'/'},
            {'target':'/tank/photos','source':'tank/photos','fstype':'zfs','size':750,'used':50,'avail':700,'options':'rw','fsroot':'/'},
            {'target':'/run','source':'tmpfs','fstype':'tmpfs','size':100,'used':10,'avail':90,'options':'rw','fsroot':'/'}]}
        raid={'name':'md0','path':'/dev/md0','type':'raid1','size':1000,'mountpoints':['/raid'],'children':[]}
        blocks={'blockdevices':[
            {'name':'sda','path':'/dev/sda','type':'disk','size':1000,'children':[raid]},
            {'name':'sdb','path':'/dev/sdb','type':'disk','size':1000,'children':[raid]}]}
        def command(args,check=True):
            text=helper.json.dumps(mountdata) if args[0]=='findmnt' else helper.json.dumps(blocks) if args[0]=='lsblk' else 'tank\t1000\t250\t750\tONLINE\n' if args[0]=='zpool' else 'tank\t250\t700\t100\t/tank\ntank/photos\t50\t700\t50\t/tank/photos\n'
            return types.SimpleNamespace(stdout=text)
        with patch.object(helper,'run',side_effect=command),patch.object(helper.shutil,'which',return_value='/bin/tool'):
            result=helper.storage_inventory()
        self.assertEqual(len(result['arrays']),1)
        self.assertEqual(result['arrays'][0]['members'],['/dev/sda','/dev/sdb'])
        self.assertEqual(result['pools'][0]['available'],700)
        self.assertEqual(result['pools'][0]['freeRaw'],750)
        self.assertEqual([m['available'] for m in result['mounts'] if m['pool']=='tank'],[700,700])
        self.assertEqual(result['mounts'][0]['reserved'],100)
        self.assertTrue(result['mounts'][-1]['technical'])
        self.assertNotIn('totalFree',result)

    def test_storage_failure_is_reported_not_silently_zeroed(self):
        with patch.object(helper,'run',side_effect=OSError('missing')),patch.object(helper.shutil,'which',return_value=None):
            result=helper.storage_inventory()
        self.assertEqual(result['mounts'],[])
        self.assertEqual(len(result['warnings']),2)
    def test_reserved_sections(self):
        for name in ['global', 'GLOBAL', 'homes', 'printers', 'print$', 'x\n[global]']:
            with self.assertRaises(ValueError):
                helper.valid_name(name)

    def test_existing_share_is_protected(self):
        with patch.object(helper, 'run', return_value=types.SimpleNamespace(stdout='[Documents]\npath=/existing\n')):
            with self.assertRaisesRegex(ValueError, 'protégé'):
                helper.save_share({'name': 'Documents'}, helper.config(''))

    def test_unsafe_paths_fail_before_filesystem_changes(self):
        with patch.object(helper, 'run', return_value=types.SimpleNamespace(stdout='[global]\n')):
            for path in ['/etc/samba', '/srv/samba/../etc', '/srv/samba/x/y', '/srv/samba/x\npath=/']:
                with self.assertRaises(ValueError):
                    helper.save_share({'name': 'SafeName', 'path': path}, helper.config(''))

    def test_unmanaged_share_cannot_be_deleted(self):
        with tempfile.TemporaryDirectory() as folder:
            state=pathlib.Path(folder)
            conf=state/'managed.conf'
            conf.write_text('[Managed]\npath=/srv/samba/managed\n')
            with patch.object(helper,'STATE',state),patch.object(helper,'CONFIG',conf):
                with self.assertRaisesRegex(ValueError,'Seuls'):
                    helper.mutate({'op':'delete_share','name':'Existing'})
                self.assertIn('[Managed]',conf.read_text())

    def test_failed_reload_restores_configuration_and_preserves_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            state=pathlib.Path(folder)
            conf=state/'managed.conf'
            original='[Managed]\npath=/srv/samba/managed\n'
            conf.write_text(original)
            def command(args,check=True):
                if check and 'reload' in args:
                    raise helper.subprocess.CalledProcessError(1,args)
                return types.SimpleNamespace(stdout='[global]\n')
            with patch.object(helper,'STATE',state),patch.object(helper,'CONFIG',conf),patch.object(helper,'run',side_effect=command):
                with self.assertRaisesRegex(ValueError,'restaurée'):
                    helper.mutate({'op':'delete_share','name':'Managed'})
                self.assertEqual(conf.read_text(),original)
                backups=list((state/'backups').glob('*.conf'))
                self.assertEqual(len(backups),1)
                self.assertEqual(backups[0].read_text(),original)

    def test_successful_delete_only_removes_definition(self):
        with tempfile.TemporaryDirectory() as folder:
            state=pathlib.Path(folder)
            data=state/'documents';data.mkdir();(data/'keep.txt').write_text('keep me')
            conf=state/'managed.conf';conf.write_text('[Managed]\npath='+str(data)+'\n')
            with patch.object(helper,'STATE',state),patch.object(helper,'CONFIG',conf),patch.object(helper,'run',return_value=types.SimpleNamespace(stdout='')):
                helper.mutate({'op':'delete_share','name':'Managed'})
                self.assertEqual(conf.read_text(),'')
                self.assertEqual((data/'keep.txt').read_text(),'keep me')

if __name__ == '__main__':
    unittest.main()
