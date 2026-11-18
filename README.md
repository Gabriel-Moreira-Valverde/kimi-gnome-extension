# 🤖 Kimi — extensão para o GNOME

O **Kimi** é um painel que fica no centro da barra superior do GNOME. Ao clicar, abre uma janela com barra lateral e várias seções úteis para o dia a dia, em português do Brasil.

## Seções

| Seção | O que faz |
|---|---|
| 🕐 **Relógio** | Hora grande com segundos, data por extenso e relógio mundial (Nova York, Londres, Lisboa, Tóquio). É a tela principal. |
| 📅 **Calendário** | Calendário mensal com **feriados nacionais do Brasil** (inclusive os móveis: Carnaval, Páscoa, Corpus Christi) e de **São Paulo** (capital e estado). Agende compromissos com hora e receba um aviso na hora marcada. |
| ⛅ **Clima** | Tempo agora em São Paulo e previsão de 5 dias (Open-Meteo). |
| 💲 **Cotações** | Dólar em destaque, euro e bitcoin em reais, com variação do dia (AwesomeAPI). |
| 📊 **Monitor** | Uso e temperatura de CPU, memória, placa de vídeo NVIDIA (via `nvidia-smi`) e disco. |
| 🔕 **Modo foco** | Silencia as notificações e pausa a música por 25 min, 50 min, 1h30 ou sem limite, com contagem regressiva na barra. |
| 📝 **Notas** | Editor de notas simples. Cada nota vira um arquivo `.txt`. |

Tudo que o Kimi cria (notas e agenda) fica em **`~/Documentos/Kimi`**.

## Requisitos

- GNOME Shell **50** ou **51**
- Opcional: driver NVIDIA com `nvidia-smi` para os dados da placa de vídeo

## Instalação

```bash
git clone https://github.com/Gabriel-Moreira-Valverde/kimi-gnome-extension.git
cd kimi-gnome-extension
./install.sh
```

Depois, **saia da sessão e entre de novo**. No Wayland, o GNOME só carrega extensões novas no login.

## Personalização

- **Seções:** a lista `SECOES` no começo de `extension.js`.
- **Cidades do relógio mundial:** `CIDADES` em `dados.js`.
- **Cidade do clima:** `SP` em `dados.js`.
- **Feriados:** função `feriados()` em `lib.js`.
- **Cores:** `stylesheet.css` (cor principal `#614AEE`).

## Serviços usados

- [Open-Meteo](https://open-meteo.com/): clima, gratuito e sem cadastro.
- [AwesomeAPI](https://docs.awesomeapi.com.br/): cotações, gratuito e sem cadastro.

O Kimi só envia a essas APIs a localização da cidade configurada. Nenhum dado pessoal sai do computador.

## Créditos e licença

- Ícone do robô: `lucide-bot` do [Lucide](https://lucide.dev) (ISC), na versão do tema [Papirus](https://github.com/PapirusDevelopmentTeam/papirus-icon-theme) (GPL-3.0).
- Código licenciado sob a **GPL-3.0**. Veja [LICENSE](LICENSE).
