#include "../src/etapa5_maquina/dinero.h"
#include <cassert>
#include <cstdio>
#include <cstring>

static int fallos = 0;
#define CHECK(cond, msg) do { if(!(cond)) { printf("FALLA: %s\n", msg); fallos++; } } while(0)

int main() {
  const uint32_t P = 450000;   // $4.500 el litro, en centavos
  const uint32_t K = 450;      // pulsos por litro

  // 1 pulso = 1/450 litro = 2,22 ml. Cuesta 450000/450 = 1000 centavos.
  CHECK(precioDeLosPulsos(1, P, K) == 1000, "1 pulso deberia costar 1000 centavos");
  CHECK(precioDeLosPulsos(450, P, K) == 450000, "450 pulsos = 1 litro = 450000");
  CHECK(precioDeLosPulsos(0, P, K) == 0, "0 pulsos = 0");

  // Redondeo HACIA ARRIBA cuando no da exacto.
  CHECK(precioDeLosPulsos(1, 100001, 3) == 33334, "techo: 100001/3 = 33333,67 -> 33334");
  CHECK(precioDeLosPulsos(1, 99999, 3) == 33333, "exacto no debe subir");

  // Truncado HACIA ABAJO al autorizar.
  CHECK(pulsosQuePagaElSaldo(500000, P, K) == 500, "5000 pesos / 10 pesos el pulso = 500");
  CHECK(pulsosQuePagaElSaldo(999, 1, 1) == 999, "1 centavo el pulso: 999 compra 999");
  CHECK(pulsosQuePagaElSaldo(999, 1000, 1) == 0, "si un pulso cuesta mas que el saldo, no autoriza nada");
  CHECK(pulsosQuePagaElSaldo(1999, 1000, 1) == 1, "1999 compra 1 pulso de 1000, no 2");
  CHECK(pulsosQuePagaElSaldo(0, P, K) == 0, "saldo 0 no autoriza nada");

  // LA GARANTIA: cobrar lo autorizado NUNCA supera el saldo.
  // Se barre un rango amplio de saldos y de precios.
  for (uint32_t precio = 1; precio < 3000; precio += 7) {
    for (uint32_t k = 1; k < 900; k += 13) {
      for (Centavos saldo = 0; saldo < 20000; saldo += 137) {
        uint32_t pmax = pulsosQuePagaElSaldo(saldo, precio, k);
        Centavos cobro = precioDeLosPulsos(pmax, precio, k);
        if (cobro > saldo) {
          printf("FALLA: saldo=%u precio=%u k=%u -> pmax=%u cobro=%u\n",
                 saldo, precio, k, pmax, cobro);
          fallos++;
          goto fin;
        }
      }
    }
  }
fin:

  // Sin desborde de 32 bits en el intermedio.
  CHECK(pulsosQuePagaElSaldo(4000000000u, 450000, 450) == 4000000u,
        "saldo grande no debe desbordar");

  // Division por cero defendida.
  CHECK(pulsosQuePagaElSaldo(1000, 0, K) == 0, "precio 0 no divide");
  CHECK(precioDeLosPulsos(1000, P, 0) == 0, "k 0 no divide");

  // Mililitros truncados.
  CHECK(mlDeLosPulsos(450, 450) == 1000, "450 pulsos = 1000 ml");
  CHECK(mlDeLosPulsos(1, 450) == 2, "1 pulso = 2,22 ml -> 2");

  // Formato sin float.
  char s[24];
  formatearPesos(12345, s, sizeof(s));  CHECK(strcmp(s, "$123,45") == 0, "formato 12345");
  formatearPesos(5, s, sizeof(s));      CHECK(strcmp(s, "$0,05") == 0, "formato 5");
  formatearPesos(100, s, sizeof(s));    CHECK(strcmp(s, "$1,00") == 0, "formato 100");
  formatearPesos(0, s, sizeof(s));      CHECK(strcmp(s, "$0,00") == 0, "formato 0");

  if (fallos == 0) printf("OK - todas las pruebas de dinero pasaron\n");
  return fallos != 0;
}
