#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ClassBoard NAS 部署辅助：SSH 登录（密码认证）、远程命令执行、文件上传。
用法：
  python scripts/nas_ssh.py exec '<命令>'
  python scripts/nas_ssh.py put <本地文件> <远程路径>
  python scripts/nas_ssh.py mkdir <远程目录>
"""
import getpass
import os
import sys
import paramiko

HOST = os.environ.get('NAS_HOST', '192.168.10.110')
USER = os.environ.get('NAS_USER', 'sour')
PASSWORD = os.environ.get('NAS_PASSWORD', '') or getpass('NAS 密码: ')
PORT = 22

_client = None


def get_client():
    global _client
    if _client is None:
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        c.connect(HOST, port=PORT, username=USER, password=PASSWORD, timeout=15)
        _client = c
    return _client


def exec_cmd(cmd):
    c = get_client()
    stdin, stdout, stderr = c.exec_command(cmd, timeout=60)
    out = stdout.read().decode('utf-8', 'replace')
    err = stderr.read().decode('utf-8', 'replace')
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def main():
    args = sys.argv[1:]
    if not args:
        print('用法: nas_ssh.py exec "<命令>" | put <本地> <远程> | mkdir <目录>')
        sys.exit(2)
    mode = args[0]
    if mode == 'exec':
        rc, out, err = exec_cmd(' '.join(args[1:]))
        if out:
            print(out)
        if err:
            print(err, file=sys.stderr)
        sys.exit(rc)
    if mode == 'mkdir':
        rc, out, err = exec_cmd('mkdir -p %s' % ' '.join(args[1:]))
        if err:
            print(err, file=sys.stderr)
        sys.exit(rc)
    if mode == 'put':
        local, remote = args[1], args[2]
        c = get_client()
        sftp = c.open_sftp()
        sftp.put(local, remote)
        sftp.close()
        print('已上传 %s -> %s' % (local, remote))
        sys.exit(0)
    raise ValueError('未知模式 %s' % mode)


if __name__ == '__main__':
    main()
