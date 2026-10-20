"""Deny external sockets and AWS client construction, including during model import/load."""

import os
import socket
from contextlib import ExitStack, contextmanager
from unittest.mock import patch


def configure_offline() -> None:
    os.environ.update(
        HF_HUB_OFFLINE="1",
        TRANSFORMERS_OFFLINE="1",
        HF_HUB_DISABLE_TELEMETRY="1",
        DO_NOT_TRACK="1",
        AWS_EC2_METADATA_DISABLED="true",
        TOKENIZERS_PARALLELISM="false",
    )


@contextmanager
def offline_only():
    configure_offline()
    original_connect = socket.socket.connect

    def blocked(*_args, **_kwargs):
        raise PermissionError("external_io_disabled")

    def connect(sock, address):
        if sock.family in {socket.AF_INET, socket.AF_INET6}:
            return blocked()
        return original_connect(sock, address)

    with ExitStack() as stack:
        for name in ("connect", "connect_ex"):
            stack.enter_context(patch.object(socket.socket, name, connect))
        for name in ("sendto", "sendmsg"):
            if hasattr(socket.socket, name):
                stack.enter_context(patch.object(socket.socket, name, blocked))
        stack.enter_context(patch.object(socket, "getaddrinfo", blocked))
        import boto3

        stack.enter_context(patch.object(boto3, "client", blocked))
        stack.enter_context(patch.object(boto3, "resource", blocked))
        stack.enter_context(patch.object(boto3.session.Session, "client", blocked))
        stack.enter_context(patch.object(boto3.session.Session, "resource", blocked))
        yield
