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

  const server = () => component.serverInstance!;

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should return whitelistEnabled based on serverInstance', () => {
    expect(component.whitelistEnabled).toBeFalse();
    server().useExclusiveList = true;
    expect(component.whitelistEnabled).toBeTrue();
  });

  it('should return empty whitelistedPlayers when none exist', () => {
    expect(component.whitelistedPlayers).toEqual([]);
  });

  it('should return whitelistedPlayers from serverInstance', () => {
    const players = [{ playerId: '123', playerName: 'Test', dateAdded: '1/1/2026' }];
    server().exclusiveJoinPlayers = players;
    expect(component.whitelistedPlayers).toEqual(players);
  });

  it('reading the list leaves the server untouched', () => {
    component.serverInstance = { exclusiveJoinPlayerIds: ['a'] };
    expect(component.whitelistedPlayers).toEqual([]);
    expect(server().exclusiveJoinPlayers).toBeUndefined();
  });

  it('should emit saveSettings and validateField on useExclusiveList change', () => {
    spyOn(component.saveSettings, 'emit');
    spyOn(component.validateField, 'emit');
    component.onUseExclusiveListChange(true);
    expect(component.validateField.emit).toHaveBeenCalledWith({ key: 'useExclusiveList', value: true });
    expect(component.saveSettings.emit).toHaveBeenCalled();
  });

  it('keeps the players when the whitelist is turned off', () => {
    component.serverInstance = {
      useExclusiveList: true,
      exclusiveJoinPlayerIds: ['a', 'b'],
      exclusiveJoinPlayers: [{ playerId: 'a' }, { playerId: 'b' }]
    };
    component.onUseExclusiveListChange(false);
    expect(server().useExclusiveList).toBeFalse();
    expect(server().exclusiveJoinPlayerIds).toEqual(['a', 'b']);
    expect(server().exclusiveJoinPlayers?.length).toBe(2);
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
    expect(server().exclusiveJoinPlayers?.length).toBe(1);
    expect(server().exclusiveJoinPlayers?.[0].playerId).toBe('12345');
    expect(server().exclusiveJoinPlayerIds).toContain('12345');
    expect(component.saveSettings.emit).toHaveBeenCalled();
    expect(component.showAddPlayerModal).toBeFalse();
  });

  it('should not add a duplicate player', () => {
    server().exclusiveJoinPlayers = [{ playerId: '123' }];
    component.newPlayerId = '123';
    spyOn(component.saveSettings, 'emit');
    component.addPlayer();
    expect(component.saveSettings.emit).not.toHaveBeenCalled();
    expect(component.statusMessage).toBe('Player is already in the whitelist');
  });

  it('should not add a player with empty id', () => {
    spyOn(component.saveSettings, 'emit');
    component.newPlayerId = '   ';
    component.addPlayer();
    expect(component.saveSettings.emit).not.toHaveBeenCalled();
  });

  it('should open remove confirm modal and remove player', () => {
    server().exclusiveJoinPlayers = [{ playerId: 'abc' }];
    server().exclusiveJoinPlayerIds = ['abc'];
    spyOn(component.saveSettings, 'emit');
    component.openRemoveConfirmModal('abc');
    expect(component.showRemoveConfirmModal).toBeTrue();
    expect(component.playerToRemove).toBe('abc');
    component.removePlayer();
    expect(server().exclusiveJoinPlayers?.length).toBe(0);
    expect(server().exclusiveJoinPlayerIds?.length).toBe(0);
    expect(component.saveSettings.emit).toHaveBeenCalled();
    expect(component.statusMessage).toBe('Player removed from whitelist');
    expect(component.statusType).toBe('success');
  });

  it('should bulk add players and emit saveSettings', () => {
    spyOn(component.saveSettings, 'emit');
    component.bulkPlayerIds = '111\n222\n333';
    component.bulkAddPlayers();
    expect(server().exclusiveJoinPlayers?.length).toBe(3);
    expect(component.saveSettings.emit).toHaveBeenCalled();
    expect(component.statusMessage).toBe('Added 3 player(s) to the whitelist');
  });

  it('should skip duplicates during bulk add and say how many', () => {
    server().exclusiveJoinPlayers = [{ playerId: '111' }];
    server().exclusiveJoinPlayerIds = ['111'];
    spyOn(component.saveSettings, 'emit');
    component.bulkPlayerIds = '111\n222\n222';
    component.bulkAddPlayers();
    expect(server().exclusiveJoinPlayers?.length).toBe(2);
    expect(component.saveSettings.emit).toHaveBeenCalled();
    expect(component.statusMessage).toBe('Added 1 player(s) to the whitelist; 2 already on the whitelist');
  });

  it('says so when a bulk add finds nothing new', () => {
    server().exclusiveJoinPlayers = [{ playerId: '111' }];
    spyOn(component.saveSettings, 'emit');
    component.bulkPlayerIds = '111';
    component.bulkAddPlayers();
    expect(component.saveSettings.emit).not.toHaveBeenCalled();
    expect(component.statusMessage).toBe('All 1 player(s) are already on the whitelist');
    expect(component.statusType).toBe('warning');
  });

  it('clears the status after a few seconds, and not after it is destroyed', () => {
    jasmine.clock().install();
    try {
      component.playerToRemove = 'x';
      component.removePlayer();
      jasmine.clock().tick(5000);
      expect(component.statusMessage).toBe('');

      component.playerToRemove = 'x';
      component.removePlayer();
      component.ngOnDestroy();
      component.statusMessage = 'kept';
      jasmine.clock().tick(5000);
      expect(component.statusMessage).toBe('kept');
    } finally {
      jasmine.clock().uninstall();
    }
  });

  it('should trackByPlayerId', () => {
    expect(component.trackByPlayerId(0, { playerId: 'abc' })).toBe('abc');
  });

  it('should migrate old string array format in ngOnChanges', () => {
    fixture.componentRef.setInput('serverInstance', { id: 'A', exclusiveJoinPlayerIds: ['id1', 'id2'] });
    fixture.detectChanges();
    expect(server().exclusiveJoinPlayers?.length).toBe(2);
    expect(server().exclusiveJoinPlayers?.[0].playerId).toBe('id1');
  });

  it('closes an open confirmation when the server changes', () => {
    fixture.componentRef.setInput('serverInstance', { id: 'A', exclusiveJoinPlayers: [{ playerId: 'x' }] });
    fixture.detectChanges();
    component.openRemoveConfirmModal('x');
    fixture.componentRef.setInput('serverInstance', { id: 'B', exclusiveJoinPlayers: [{ playerId: 'x' }] });
    fixture.detectChanges();
    expect(component.showRemoveConfirmModal).toBeFalse();
    expect(component.playerToRemove).toBe('');
  });
});
