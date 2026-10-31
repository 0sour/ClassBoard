#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""ClassBoard NAS 部署驱动（本地运行，SSH 操作 NAS 上的 Docker 项目）。

把「部署备忘」里的动作固化成可重复执行的步骤，避免手工敲命令踩坑：
  * 发布包只覆盖源码目录，绝不动 data/、backups/、.env
  * 构建前先停容器并备份 data/*.db*（WAL 需要停容器才会落盘）
  * 构建必须带镜像源参数（NAS 网络到 github.com / unofficial-builds 不通）
  * 部署后打印容器日志（迁移信息在这里）

用法：
  python scripts/nas_deploy.py upload <本地 tar.gz> <远程名>   # 上传发布包到 backups/
  python scripts/nas_deploy.py deploy <远程包名>               # 停容器→备份→清源码→解包→构建→启动→日志
  python scripts/nas_deploy.py exec "<远程命令>" [超时秒]        # 任意远程命令（流式输出）
  python scripts/nas_deploy.py logs [行数]

环境变量：NAS_HOST（必填）/ NAS_USER（必填）/ NAS_PASSWORD（必填）/ NAS_PROJECT（默认 /srv/classboard）
"""
import os
import sys
import time

import paramiko

HOST = os.environ.get('NAS_HOST', '')
USER = os.environ.get('NAS_USER', '')
PASSWORD = os.environ.get('NAS_PASSWORD', '')
PROJECT = os.environ.get('NAS_PROJECT', '/srv/classboard')

if not HOST or not USER:
    print('请设置 NAS_HOST / NAS_USER（以及 NAS_PASSWORD）环境变量', file=sys.stderr)
    raise SystemExit(2)
# 发布包覆盖的源码目录（其余目录保持不动）
SOURCE_DIRS = ['server', 'frontend', 'docs', 'scripts']
BUILD_ARGS = (
    '--build-arg NPM_REGISTRY=https://registry.npmmirror.com '
    '--build-arg NPM_BINARY_HOST=https://registry.npmmirror.com/-/binary/better-sqlite3'
)

_client = None


def client():
    global _client
    if _client is None:
        c = paramiko.SSHClient()
        c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        c.connect(HOST, username=USER, password=PASSWORD, timeout=20)
        _client = c
    return _client


def run(cmd, timeout=None, stream=True, quiet=False):
    """执行远程命令；stream=True 时边收边打印（长任务不会因静默被 sshd 断开）。"""
    chan = client().get_transport().open_session()
    chan.settimeout(None)
    chan.exec_command(cmd)
    out = []
    while True:
        if chan.recv_ready():
            data = chan.recv(65536).decode('utf-8', 'replace')
            out.append(data)
            if stream and not quiet:
                sys.stdout.write(data)
                sys.stdout.flush()
        elif chan.exit_status_ready():
            while chan.recv_ready():
                data = chan.recv(65536).decode('utf-8', 'replace')
                out.append(data)
                if stream and not quiet:
                    sys.stdout.write(data)
                    sys.stdout.flush()
            break
        else:
            time.sleep(0.15)
    rc = chan.recv_exit_status()
    chan.close()
    return rc, ''.join(out)


def must(cmd, **kw):
    rc, out = run(cmd, **kw)
    if rc != 0:
        raise SystemExit('[中止] 远程命令失败（%s）：%s' % (rc, cmd))
    return out


def remote_tar(name):
    return '%s/backups/%s' % (PROJECT, name)


def do_upload(local, name):
    c = client()
    sftp = c.open_sftp()
    remote = remote_tar(name)
    sftp.put(local, remote)
    size = sftp.stat(remote).st_size
    sftp.close()
    print('已上传 %s -> %s（%d 字节）' % (local, remote, size))


def do_deploy(name):
    stamp = time.strftime('pre-deploy-%Y%m%d-%H%M%S')
    print('== 1/6 停容器（WAL 落盘） ==')
    must('cd %s && docker compose stop' % PROJECT)
    print('== 2/6 备份 data/*.db* -> backups/%s ==' % stamp)
    must('cd %s && mkdir -p backups/%s && cp -a data/*.db* backups/%s/ && ls -la backups/%s' % (PROJECT, stamp, stamp, stamp))
    print('== 3/6 清空源码目录（保留 data/ backups/ .env examples/） ==')
    must('cd %s && rm -rf %s' % (PROJECT, ' '.join(SOURCE_DIRS)))
    print('== 4/6 解包 ==')
    must('cd %s && tar -xzf backups/%s && ls' % (PROJECT, name))
    print('== 5/6 构建（镜像源参数已带） ==')
    must('cd %s && docker compose build %s' % (PROJECT, BUILD_ARGS))
    print('== 6/6 启动 ==')
    must('cd %s && docker compose up -d && sleep 4 && docker compose ps' % PROJECT)
    print('== 容器日志 ==')
    run('cd %s && docker compose logs --tail=80' % PROJECT)


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    if not PASSWORD:
        print('[中止] 请设置 NAS_PASSWORD 环境变量')
        sys.exit(2)
    mode = args[0]
    if mode == 'upload':
        do_upload(args[1], args[2])
    elif mode == 'deploy':
        do_deploy(args[1])
    elif mode == 'exec':
        timeout = int(args[2]) if len(args) > 2 else None
        rc, out = run(args[1], timeout=timeout)
        sys.exit(rc)
    elif mode == 'logs':
        n = args[1] if len(args) > 1 else '80'
        run('cd %s && docker compose logs --tail=%s' % (PROJECT, n))
    else:
        raise SystemExit('未知模式 %s' % mode)


if __name__ == '__main__':
    main()
