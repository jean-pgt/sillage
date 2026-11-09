"""Contained administration tests: no real Samba config, users or groups changed."""
import importlib.util,pathlib,tempfile,types,unittest,hashlib
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('helper',pathlib.Path(__file__).with_name('samba-manager-helper.py'))
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
data_roots=h._data_roots

class AdminTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=pathlib.Path(self.temp.name)
        self.main=self.root/'smb.conf';self.managed=self.root/'managed.conf';self.data=self.root/'volume';self.data.mkdir()
        self.original='[global]\n  workgroup = TEST\n\n[Documents]\n  path = '+str(self.data)+'\n  vfs objects = acl_xattr\n  read only = no\n  # preserve this comment\n'
        self.main.write_text(self.original);self.managed.write_text('')
        self.calls=[]
        def run(args,check=True):
            self.calls.append(args)
            return types.SimpleNamespace(stdout=self.main.read_text()+self.managed.read_text())
        self.patches=[patch.object(h,'SMB_CONFIG',self.main),patch.object(h,'CONFIG',self.managed),patch.object(h,'STATE',self.root/'state'),patch.object(h,'ROOT',self.root/'new-root'),patch.object(h,'run',side_effect=run),patch.object(h,'storage_inventory',return_value={'mounts':[{'target':str(self.data),'technical':False,'readOnly':False}]}),patch.object(h.grp,'getgrnam',return_value=types.SimpleNamespace(gr_gid=1001,gr_name='famille',gr_mem=[]))]
        self.patches.append(patch.object(h,'_data_roots',return_value=[str(self.root/'new-root'),str(self.data)]))
        for p in self.patches:p.start()
    def tearDown(self):
        for p in reversed(self.patches):p.stop()
        self.temp.cleanup()
    def request(self,**extra):
        return {'op':'configure_share','name':'Documents','path':str(self.data),'revision':h._revision(self.main.read_text()),'readOnly':True,'group':'','validUsers':'@famille','writeList':'','comment':'Modifié','browseable':True,'createDirectory':False,'applyPermissions':False,**extra}
    def test_existing_share_is_editable_without_losing_unrelated_settings(self):
        h.configure_share(self.request())
        text=self.main.read_text();self.assertIn('vfs objects = acl_xattr',text);self.assertIn('# preserve this comment',text);self.assertIn('read only = yes',text)
        self.assertEqual(len(list((self.root/'state/backups').glob('*'))),1)
    def test_existing_guest_setting_is_preserved(self):
        self.main.write_text(self.original+'  guest ok = yes\n')
        h.configure_share(self.request())
        self.assertIn('guest ok = yes',self.main.read_text())
    def test_missing_existing_directory_can_be_created_explicitly(self):
        missing=self.data/'missing'
        self.main.write_text(self.original.replace('path = '+str(self.data),'path = '+str(missing)))
        with patch.object(h.os,'chown'):
            h.configure_share(self.request(path=str(missing),createDirectory=True,group='famille'))
        self.assertTrue(missing.is_dir())
    def test_revision_prevents_stale_overwrite(self):
        with self.assertRaisesRegex(ValueError,'changé'):h.configure_share(self.request(revision='0'*64))
        self.assertEqual(self.main.read_text(),self.original)
    def test_reload_failure_restores_main_file(self):
        def run(args,check=True):
            if 'reload' in args and check:raise h.subprocess.CalledProcessError(1,args)
            return types.SimpleNamespace(stdout=self.main.read_text())
        with patch.object(h,'run',side_effect=run):
            with self.assertRaisesRegex(ValueError,'restaurées'):h.configure_share(self.request())
        self.assertEqual(self.main.read_text(),self.original)
    def test_delete_existing_definition_preserves_data(self):
        file=self.data/'important.txt';file.write_text('keep')
        h.configure_share(self.request(op='remove_share'))
        self.assertNotIn('[Documents]',self.main.read_text());self.assertEqual(file.read_text(),'keep')
    def test_permissions_are_not_modified_by_default(self):
        with patch.object(h.os,'chown') as owner,patch.object(h.os,'chmod',wraps=h.os.chmod) as mode:
            h.configure_share(self.request())
        owner.assert_not_called()
        self.assertFalse(any(pathlib.Path(call.args[0])==self.data for call in mode.call_args_list))
    def test_explicit_permissions_touch_only_root_folder(self):
        child=self.data/'child';child.mkdir()
        with patch.object(h.os,'chown') as owner,patch.object(h.os,'chmod',wraps=h.os.chmod) as mode:
            h.configure_share(self.request(group='famille',applyPermissions=True))
        owner.assert_called_once_with(self.data,-1,1001)
        self.assertFalse(any(pathlib.Path(call.args[0])==child for call in mode.call_args_list))
    def test_new_share_can_use_data_volume(self):
        with patch.object(h.os,'chown'):
            h.configure_share(self.request(name='Photos',path=str(self.data/'Photos'),revision=None,createDirectory=True,group='famille'))
        self.assertTrue((self.data/'Photos').is_dir());self.assertIn('[Photos]',self.managed.read_text())
    def test_symlink_and_system_paths_are_refused(self):
        with self.assertRaises(ValueError):h.configure_share(self.request(name='New',path='/etc',revision=None))
        (self.data/'link').symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(ValueError):h.configure_share(self.request(name='New',path=str(self.data/'link/x'),revision=None))
    def test_configuration_injection_is_rejected(self):
        for extra in [{'comment':'x\n[global]'},{'validUsers':'alice\nguest ok=yes'},{'name':'x\n[global]'}]:
            with self.assertRaises(ValueError):h.configure_share(self.request(**extra))
    def test_privileged_accounts_groups_are_rejected(self):
        for name in ['root','sudo','docker','samba-manager','x;id','-option']:
            with self.assertRaises(ValueError):h._safe_account(name)
    def test_only_data_mounts_are_offered_as_creation_roots(self):
        mounts=[{'target':p,'technical':False,'readOnly':False} for p in ['/','/mnt/raid','/etc','/tmp/x','/var/lib']]
        roots=data_roots({'mounts':mounts})
        self.assertIn('/mnt/raid',roots)
        for p in ['/','/etc','/tmp/x','/var/lib']:self.assertNotIn(p,roots)
    def test_password_is_stdin_only_and_existing_linux_account_is_preserved(self):
        user=types.SimpleNamespace(pw_uid=1000,pw_gid=1000)
        with patch.object(h.pwd,'getpwnam',return_value=user),patch.object(h.grp,'getgrall',return_value=[]),patch.object(h.subprocess,'run',return_value=types.SimpleNamespace(returncode=0)) as command:
            h.save_user({'name':'alice','password':'new-example-password','groups':[]})
        args=command.call_args.args[0];self.assertEqual(args,['/usr/bin/smbpasswd','-a','-s','alice']);self.assertNotIn('new-example-password',args)
        self.assertEqual(command.call_args.kwargs['input'],'new-example-password\nnew-example-password\n')
        self.assertFalse(any('/usr/sbin/useradd' in x for x in self.calls))
    def test_group_members_do_not_allow_system_users(self):
        with patch.object(h.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=0)):
            with self.assertRaises(ValueError):h.save_group({'name':'famille','members':['daemon']})

if __name__=='__main__':unittest.main()
