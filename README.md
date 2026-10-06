# Medidor de Rentabilidad de Inversiones

Aplicación web para comparar inversiones (depósitos a plazo y depósitos de rentabilidad variable) y ver
cuánto se gana al final de un período.

## 👉 Abrir la aplicación

**https://mplsolutions.github.io/Medidor_Rentabilidad_Inversiones/**

También puedes descargar el repositorio y abrir `index.html` en tu navegador (no requiere instalación).

## Qué hace

- Compara varias inversiones al mismo horizonte (meses), en **CLP o USD**.
- Datos por inversión: nombre, fecha, monto inicial, plazo, aportes periódicos, dividendos/cupones,
  reinversión de intereses, comisión de administración y comisión de ingreso.
- Rentabilidad **fija** o **variable**, con distribuciones: uniforme, normal, triangular y escenarios discretos
  (simulación Monte Carlo de 1.500 trayectorias).
- Métricas: total aportado, valor final (mediana y rango P10–P90), ganancia, retorno simple, retorno anualizado (TIR),
  ganancia y retorno real (ajustado por inflación), comparación con un benchmark, riesgo (desv. estándar),
  probabilidad de pérdida y de rendir menos que la inflación.
- Gráficos: evolución en el tiempo, comparativo de ganancias y distribución del resultado final.
- Guardar y cargar tus datos en un archivo **JSON**, exportar resultados en **CSV**. También se guarda
  automáticamente en tu navegador.
- Interfaz en **español** e **inglés** (selector arriba a la derecha). Viene precargada con un ejemplo ficticio.

## Supuestos importantes

- Las tasas de las inversiones en USD se ingresan en USD; la conversión usa el tipo de cambio fijo indicado.
- Si una inversión vence antes del horizonte, su dinero queda sin rentar hasta el final (el benchmark sí sigue rentando).
- La tasa variable se sortea una vez por cada año de plazo. Los resultados son simulaciones, no garantías.
- Herramienta educativa; no constituye asesoría financiera.

## Estructura

```
index.html        Página principal
css/styles.css    Estilos
js/calc.js        Motor de cálculo (simulación, TIR, benchmark)
js/i18n.js        Textos ES / EN
js/app.js         Interfaz, gráficos, guardar/cargar
```

Los gráficos usan [Chart.js](https://www.chartjs.org/) cargado desde un CDN, por lo que se necesita conexión a internet.
