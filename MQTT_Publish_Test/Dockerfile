# =============================================================
# MQTT-Testdaten-Generator — nicht fuer Produktion, nur fuer lokale
# Entwicklung/Demo gedacht (siehe docker-compose.yml, Dienst "simulator").
# =============================================================
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY mqtt_simulator.py ./

CMD ["python", "mqtt_simulator.py"]
