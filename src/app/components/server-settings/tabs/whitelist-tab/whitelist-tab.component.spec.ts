import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WhitelistTabComponent } from './whitelist-tab.component';

describe('WhitelistTabComponent', () => {
  let component: WhitelistTabComponent;
  let fixture: ComponentFixture<WhitelistTabComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WhitelistTabComponent]
    }).compileComponents();
    fixture = TestBed.createComponent(WhitelistTabComponent);
    component = fixture.componentInstance;
    component.serverInstance = {
      useExclusiveList: false,
      exclusiveJoinPlayerIds: [],
      exclusiveJoinPlayers: []
    };
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should return whitelistEnabled based on serverInstance', () => {
    expect(component.whitelistEnabled).toBeFalse();
    component.serverInstance.useExclusiveList = true;
    expect(component.whitelistEnabled).toBeTrue();
  });

  it('should return empty whitelistedPlayers when none exist', () => {
    expect(component.whitelistedPlayers).toEqual([]);
  });

  it('should return whitelistedPlayers from serverInstance', () => {
    const players = [{ playerId: '123', playerName: 'Test', dateAdded: '1/1/2026' }];
    component.serverInstance.exclusiveJoinPlayers = players;
    expect(component.whitelistedPlayers).toEqual(players);
  });

  it('should emit saveSettings and validateField on useExclusiveList change', () => {
    spyOn(component.saveSettings, 'emit');
    spyOn(component.validateField, 'emit');
    component.onUseExclusiveListChange(true);
    expect(component.validateField.emit).toHaveBeenCalledWith({ key: 'useExclusiveList', value: true });
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  it('should open and close add player modal', () => {
    component.openAddPlayerModal();
    expect(component.showAddPlayerModal).toBeTrue();
    component.closeModal();
    expect(component.showAddPlayerModal).toBeFalse();
  });

  it('should open and close bulk add modal', () => {
    component.openBulkAddModal();
    expect(component.showBulkAddModal).toBeTrue();
    component.closeModal();
    expect(component.showBulkAddModal).toBeFalse();
  });

  it('should add a player and emit saveSettings', () => {
    spyOn(component.saveSettings, 'emit');
    component.newPlayerId = '  12345  ';
    component.newPlayerName = 'Player1';
    component.showAddPlayerModal = true;
    component.addPlayer();
    expect(component.serverInstance.exclusiveJoinPlayers.length).toBe(1);
    expect(component.serverInstance.exclusiveJoinPlayers[0].playerId).toBe('12345');
    expect(component.serverInstance.exclusiveJoinPlayerIds).toContain('12345');
    expect(component.saveSettings.emit).toHaveBeenCalled();
    expect(component.showAddPlayerModal).toBeFalse();
  });

  it('should not add a duplicate player', () => {
    component.serverInstance.exclusiveJoinPlayers = [{ playerId: '123' }];
    component.newPlayerId = '123';
    spyOn(component.saveSettings, 'emit');
    component.addPlayer();
    expect(component.saveSettings.emit).not.toHaveBeenCalled();
  });

  it('should not add a player with empty id', () => {
    spyOn(component.saveSettings, 'emit');
    component.newPlayerId = '   ';
    component.addPlayer();
    expect(component.saveSettings.emit).not.toHaveBeenCalled();
  });

  it('should open remove confirm modal and remove player', () => {
    component.serverInstance.exclusiveJoinPlayers = [{ playerId: 'abc' }];
    component.serverInstance.exclusiveJoinPlayerIds = ['abc'];
    spyOn(component.saveSettings, 'emit');
    component.openRemoveConfirmModal('abc');
    expect(component.showRemoveConfirmModal).toBeTrue();
    expect(component.playerToRemove).toBe('abc');
    component.removePlayer();
    expect(component.serverInstance.exclusiveJoinPlayers.length).toBe(0);
    expect(component.serverInstance.exclusiveJoinPlayerIds.length).toBe(0);
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  it('should bulk add players and emit saveSettings', () => {
    spyOn(component.saveSettings, 'emit');
    component.bulkPlayerIds = '111\n222\n333';
    component.bulkAddPlayers();
    expect(component.serverInstance.exclusiveJoinPlayers.length).toBe(3);
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  it('should skip duplicates during bulk add', () => {
    component.serverInstance.exclusiveJoinPlayers = [{ playerId: '111' }];
    component.serverInstance.exclusiveJoinPlayerIds = ['111'];
    spyOn(component.saveSettings, 'emit');
    component.bulkPlayerIds = '111\n222';
    component.bulkAddPlayers();
    expect(component.serverInstance.exclusiveJoinPlayers.length).toBe(2);
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  it('should emit statusUpdate via showStatus on remove', () => {
    spyOn(component.statusUpdate, 'emit');
    component.serverInstance.exclusiveJoinPlayers = [{ playerId: 'x' }];
    component.serverInstance.exclusiveJoinPlayerIds = ['x'];
    component.playerToRemove = 'x';
    component.removePlayer();
    expect(component.statusUpdate.emit).toHaveBeenCalledWith(jasmine.objectContaining({ type: 'success' }));
  });

  it('should trackByPlayerId', () => {
    expect(component.trackByPlayerId(0, { playerId: 'abc' } as any)).toBe('abc');
  });

  it('should migrate old string array format in ngOnChanges', () => {
    component.serverInstance = {
      exclusiveJoinPlayerIds: ['id1', 'id2']
    };
    component.ngOnChanges({
      serverInstance: { currentValue: component.serverInstance } as any
    });
    expect(component.serverInstance.exclusiveJoinPlayers.length).toBe(2);
    expect(component.serverInstance.exclusiveJoinPlayers[0].playerId).toBe('id1');
  });
});
