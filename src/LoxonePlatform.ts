import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';
import { StructureFile, Controls, Control, MSInfo } from './structure/LoxAPP3';
import { LoxoneAccessory } from './LoxoneAccessory';
import LoxoneHandler from './lib/LoxoneHandler';

export class LoxonePlatform implements DynamicPlatformPlugin {

  private LoxoneRooms = {};
  private LoxoneCats = {};
  private LoxoneItems: Controls = {};
  private LoxoneIntercomMotion = '';

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public LoxoneHandler: any;
  public msInfo = {} as MSInfo;
  public LoxoneItemCount = 1;
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];  // this is used to track restored cached accessories

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.api.on('didFinishLaunching', () => this.LoxoneInit());
  }

  async LoxoneInit() {
    this.log.info('Initializing Loxone Connection');

    // New Miniserver websocket
    this.LoxoneHandler = new LoxoneHandler(this);

    // Wait for configfile. (LoxAPP3.json)
    while (!this.LoxoneHandler.loxdata) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.log.debug(`[LoxoneInit] got structure file; last modified on ${this.LoxoneHandler.loxdata.lastModified}`);
    this.parseLoxoneConfig(this.LoxoneHandler.loxdata);
  }

  async parseLoxoneConfig(config: StructureFile) {

    // MSinfo
    this.msInfo = config.msInfo;

    // Loxone Rooms
    for (const RoomUuid in config.rooms) {
      this.LoxoneRooms[RoomUuid] = config.rooms[RoomUuid].name;
    }

    // Loxone Cats
    for (const CatUuid in config.cats) {
      this.LoxoneCats[CatUuid] = config.cats[CatUuid].type;
    }

    // Loxone Items
    for (const ItemUuid in config.controls) {
      const LoxoneItem = config.controls[ItemUuid];
      this.LoxoneItems[ItemUuid] = LoxoneItem;
      this.LoxoneItems[ItemUuid].room = this.LoxoneRooms[LoxoneItem.room];
      this.LoxoneItems[ItemUuid].cat = this.LoxoneCats[LoxoneItem.cat];
      this.LoxoneItems[ItemUuid].type = this.checkLoxoneType(LoxoneItem);
    }

    this.mapLoxoneItems(this.LoxoneItems);  // Map all discovered Loxone Items
    this.removeUnmappedAccessories(); // Remove Cached Items which are removed from Loxone
  }

  checkLoxoneType(LoxoneItem: Control) {

    // Add motionSensor state to IntercomV2 Item
    if (LoxoneItem.type === 'IntercomV2') {
      LoxoneItem.states.active = this.LoxoneIntercomMotion;
    }

    if (LoxoneItem.type === 'Switch') {
      // Map Switch with Lock Alias to LockItem
      if (this.config.switchAlias?.Lock && LoxoneItem.name.includes(this.config.switchAlias.Lock)) {
        return 'Lock';
      }
    }

    // Change Pushbutton to Switch
    if (LoxoneItem.type === 'Pushbutton') {
      return 'Switch';
    }

    if (LoxoneItem.type === 'InfoOnlyAnalog') {
      // Map InfoOnlyAnalog with Humidity Alias to HumidityItem
      if (this.config.InfoOnlyAnalogAlias?.Humidity && LoxoneItem.name.includes(this.config.InfoOnlyAnalogAlias.Humidity)) {
        return 'Humidity';
      }

      // Map InfoOnlyAnalog with Brightness Alias to BriightnessItem
      if (this.config.InfoOnlyAnalogAlias?.Brightness && LoxoneItem.name.includes(this.config.InfoOnlyAnalogAlias.Brightness)) {
        return 'Brightness';
      }
    }

    if (LoxoneItem.type === 'InfoOnlyDigital') {
      // Map InfoOnlyDigital' with Motion Alias to MotionItem
      if (this.config.InfoOnlyDigitalAlias?.Motion && LoxoneItem.name.includes(this.config.InfoOnlyDigitalAlias.Motion)) {
        return 'Motion';
      }

      // Map Intercom MotionSensor to Intercom object
      if (LoxoneItem.name.includes('IntercomV2')) {
        this.LoxoneIntercomMotion = LoxoneItem.uuidAction;
      }
    }
    return LoxoneItem.type;
  }

  async mapLoxoneItems(LoxoneItems: Controls) {
    for (const uuid in LoxoneItems) {
      new LoxoneAccessory(this, LoxoneItems[uuid]);
    }
  }

  removeUnmappedAccessories() {
    this.accessories.forEach((accessory: PlatformAccessory) => {
      if (!accessory.context.mapped) {
        this.log.debug('Remove accessory: ', accessory.displayName);
        this.api.unregisterPlatformAccessories('homebridge-loxone-proxy', 'LoxonePlatform', [accessory]);
      }
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.debug('Loading accessory from cache:', accessory.displayName);
    accessory.context.mapped = false; // To enable the removal of cached accessories removed from Loxone
    this.accessories.push(accessory);
  }
}