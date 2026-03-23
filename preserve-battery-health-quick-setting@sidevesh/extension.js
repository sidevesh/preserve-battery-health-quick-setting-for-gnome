import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as QuickSettings from 'resource:///org/gnome/shell/ui/quickSettings.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';

const UPowerIface = `
<node>
  <interface name="org.freedesktop.UPower">
    <method name="EnumerateDevices">
      <arg name="devices" type="ao" direction="out"/>
    </method>
  </interface>
</node>`;

const UPowerDeviceIface = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="Type" type="u" access="read"/>
    <property name="PowerSupply" type="b" access="read"/>
    <property name="ChargeThresholdSupported" type="b" access="read"/>
    <property name="ChargeThresholdEnabled" type="b" access="read"/>
    
    <method name="EnableChargeThreshold">
      <arg name="enabled" type="b" direction="in"/>
    </method>
  </interface>
</node>`;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPowerIface);
const UPowerDeviceProxy = Gio.DBusProxy.makeProxyWrapper(UPowerDeviceIface);

const PreserveBatteryHealthToggle = GObject.registerClass(
class PreserveBatteryHealthToggle extends QuickSettings.QuickToggle {
    _init() {
        super._init({
            title: 'Preserve Battery',
            iconName: 'battery-good-symbolic',
            toggleMode: true,
        });

        this._deviceProxies = [];
        this._cancellable = new Gio.Cancellable();

        this.connect('clicked', () => this._toggleChargeThreshold());

        this._setupDBus();
    }

    async _setupDBus() {
        try {
            this._upowerProxy = await new Promise((resolve, reject) => {
                new UPowerProxy(
                    Gio.DBus.system,
                    'org.freedesktop.UPower',
                    '/org/freedesktop/UPower',
                    (proxy, error) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve(proxy);
                        }
                    },
                    this._cancellable
                );
            });

            const devices = await this._upowerProxy.EnumerateDevicesAsync();
            for (const path of devices[0]) {
                const deviceProxy = await new Promise((resolve, reject) => {
                    new UPowerDeviceProxy(
                        Gio.DBus.system,
                        'org.freedesktop.UPower',
                        path,
                        (proxy, error) => {
                            if (error) {
                                reject(error);
                            } else {
                                resolve(proxy);
                            }
                        },
                        this._cancellable
                    );
                });

                // UP_DEVICE_KIND_BATTERY is 2
                if (deviceProxy.Type === 2 && deviceProxy.PowerSupply && deviceProxy.ChargeThresholdSupported) {
                    this._deviceProxies.push(deviceProxy);
                    deviceProxy.connect('g-properties-changed', () => this._sync());
                }
            }

            this._sync();
            
            if (this._deviceProxies.length === 0) {
                this.visible = false;
            } else {
                this.visible = true;
            }
        } catch (e) {
            console.log('Failed to setup UPower DBus:', e);
            this.visible = false;
        }
    }

    _sync() {
        if (this._deviceProxies.length === 0) return;
        
        let anyEnabled = false;
        for (const proxy of this._deviceProxies) {
            if (proxy.ChargeThresholdEnabled) {
                anyEnabled = true;
                break;
            }
        }

        this.checked = anyEnabled;
    }

    async _toggleChargeThreshold() {
        const newState = this.checked;
        
        for (const proxy of this._deviceProxies) {
            try {
                await proxy.EnableChargeThresholdAsync(newState);
            } catch (e) {
                console.log('Failed to set charge threshold:', e);
            }
        }
    }

    destroy() {
        this._cancellable.cancel();
        super.destroy();
    }
});

const PreserveBatteryHealthIndicator = GObject.registerClass(
class PreserveBatteryHealthIndicator extends QuickSettings.SystemIndicator {
    _init() {
        super._init();
        this._toggle = new PreserveBatteryHealthToggle();
        this.quickSettingsItems.push(this._toggle);
    }
});

export default class PreserveBatteryHealthExtension extends Extension {
    enable() {
        this._indicator = new PreserveBatteryHealthIndicator();
        Main.panel.statusArea.quickSettings.addExternalIndicator(this._indicator);
    }

    disable() {
        this._indicator.destroy();
        this._indicator = null;
    }
}
