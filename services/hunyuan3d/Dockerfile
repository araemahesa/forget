# Toolkit/compiler inside container; uses existing host NVIDIA driver via GPU runtime.
# No Hunyuan source/weights downloaded until explicitly licensed setup is run.
FROM nvidia/cuda:12.4.1-cudnn-devel-ubuntu22.04
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    python3.10 python3.10-dev python3.10-venv git g++ ca-certificates libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1000 worker
COPY --chown=worker:worker worker.py setup.sh run.sh requirements.txt /opt/forgekit-hunyuan3d/
USER worker
ENV PYTHON=python3.10 HUNYUAN_HOME=/home/worker/.local/share/forgekit-hunyuan3d
WORKDIR /opt/forgekit-hunyuan3d
CMD ["./run.sh"]
