#!/bin/sh
# Pruebas de las reglas de negocio que se pueden correr en la compu, sin placa.
#
# La matemática de la plata no necesita un ESP32 para probarse, y es la parte
# que no puede estar mal ni una vez. Corre en un segundo y no depende de tener
# el hardware enchufado.
set -e
cd "$(dirname "$0")"
g++ -O2 -Wall -Wextra -o /tmp/grifo_test_dinero test_dinero.cpp
/tmp/grifo_test_dinero
