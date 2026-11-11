[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5?style=for-the-badge&logo=homeassistantcommunitystore&logoColor=white)](https://hacs.xyz/docs/faq/custom_repositories/)
[![Release](https://img.shields.io/github/v/release/filipeamorimdev/home-assistant-beszel-agent-integration?style=for-the-badge&logo=github&logoColor=white)](https://github.com/filipeamorimdev/home-assistant-beszel-agent-integration/releases)
[![Validate](https://img.shields.io/github/actions/workflow/status/filipeamorimdev/home-assistant-beszel-agent-integration/validate.yml?style=for-the-badge&logo=githubactions&logoColor=white&label=validate)](https://github.com/filipeamorimdev/home-assistant-beszel-agent-integration/actions/workflows/validate.yml)

[English](README.md) · [Português](README.pt.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md)

# Beszel Agent Integration

Lleva los servidores que monitorizas con [Beszel](https://github.com/henrygd/beszel) a Home Assistant como dispositivos, sensores y tarjetas de panel listas para usar.

![Vista previa de Beszel Agent Integration](docs/images/beszel-card-preview.gif)

> Proyecto no oficial, sin relación con Beszel. Necesitas un Beszel Hub en funcionamiento y un agente en cada máquina que quieras ver.

## Instalación rápida

Busca **Beszel Agent Integration** en el Marketplace/HACS de Home Assistant.

### Otras opciones

[![Abre tu instancia de Home Assistant y abre este repositorio en HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=filipeamorimdev&repository=home-assistant-beszel-agent-integration&category=integration)

1. Configura un [Beszel Hub](https://beszel.dev/guide/getting-started) e [instala el agente](https://beszel.dev/guide/agent-installation) en cada máquina.
2. Añade este repositorio a HACS con el botón de arriba (tipo **Integración**), descárgalo y reinicia Home Assistant (2026.6 o posterior).
3. Ve a **Ajustes → Dispositivos y servicios → Añadir integración**, elige **Beszel Agent Integration** e inicia sesión con la URL del Hub y un usuario normal de Beszel (basta con solo lectura).

Cada sistema que aparece como **Up** en Beszel se convierte en un dispositivo de Home Assistant. Consulta la [guía de instalación](docs/INSTALLATION.md) (en inglés) para la instalación manual y los detalles de configuración.

## Tarjetas de panel

La integración incluye dos tarjetas, sin recurso de Lovelace que añadir: una **tarjeta de máquina** para un servidor y una **tabla de sistemas** para todos.

| Tarjeta de máquina | Tabla de sistemas |
| --- | --- |
| ![Tarjeta de máquina compacta](docs/images/beszel-machine-compact.png) | ![Tabla de sistemas](docs/images/beszel-systems-table-compact.png) |

Las tarjetas muestran el texto en español con la opción `language: es`.

## Documentación

En inglés:

- [Instalación y configuración](docs/INSTALLATION.md)
- [Tarjetas de panel y opciones](docs/CARDS.md)
- [Sensores y solución de problemas](docs/SENSORS.md)

[Informar de un problema](https://github.com/filipeamorimdev/home-assistant-beszel-agent-integration/issues) · [Registro de cambios](CHANGELOG.md) · [Seguridad](SECURITY.md) · [Licencia MIT](LICENSE)

## Créditos

Toda la monitorización la hace **[Beszel](https://github.com/henrygd/beszel)**, de [henrygd](https://github.com/henrygd) y sus colaboradores (MIT); esta integración solo muestra sus datos en Home Assistant. Si te resulta útil, considera dar también una estrella a Beszel.

Este proyecto nació de [home-assistant-glances-card](https://github.com/filipeamorimdev/home-assistant-glances-card) cuando pasé mi monitorización de Glances a Beszel.
