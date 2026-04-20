import type { Dispatch, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';

import type { BrowserAppSettings } from '@dg-agent/storage-browser';
import { clampStrengthSetting } from '../../utils/ui-formatters.js';
import { SettingSegmented } from './SettingSegmented.js';
import { SettingToggle } from './SettingToggle.js';

interface SafetyTabProps {
  settingsDraft: BrowserAppSettings;
  setSettingsDraft: Dispatch<SetStateAction<BrowserAppSettings>>;
}

export function SafetyTab({ settingsDraft, setSettingsDraft }: SafetyTabProps) {
  return (
    <div className="settings-panel-tab-content">
      <section className="settings-group">
        <h3 className="settings-group-title">安全</h3>

        <SettingSegmented
          label="权限策略"
          value={settingsDraft.permissionMode}
          onValueChange={(value) =>
            setSettingsDraft((current) => ({
              ...current,
              permissionMode: value as BrowserAppSettings['permissionMode'],
            }))
          }
          options={[
            { value: 'confirm', label: '每次确认' },
            { value: 'timed', label: '放行 5 分钟' },
            { value: 'allow-all', label: '全部放行' },
          ]}
        />

        <label>
          <span>A 通道强度上限</span>
          <Input
            type="number"
            min={0}
            max={200}
            value={settingsDraft.maxStrengthA}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                maxStrengthA: clampStrengthSetting(event.target.value),
              }))
            }
          />
        </label>

        <label>
          <span>B 通道强度上限</span>
          <Input
            type="number"
            min={0}
            max={200}
            value={settingsDraft.maxStrengthB}
            onChange={(event) =>
              setSettingsDraft((current) => ({
                ...current,
                maxStrengthB: clampStrengthSetting(event.target.value),
              }))
            }
          />
        </label>

        <SettingToggle
          label="离开页面时自动停止设备输出"
          checked={settingsDraft.safetyStopOnLeave}
          onCheckedChange={(checked) =>
            setSettingsDraft((current) => ({
              ...current,
              safetyStopOnLeave: checked,
            }))
          }
        />

        <SettingToggle
          label="启动时显示安全确认"
          checked={settingsDraft.showSafetyNoticeOnStartup}
          onCheckedChange={(checked) =>
            setSettingsDraft((current) => ({
              ...current,
              showSafetyNoticeOnStartup: checked,
            }))
          }
        />

        <SettingToggle
          label="切到后台后继续运行"
          checked={settingsDraft.backgroundBehavior === 'keep'}
          onCheckedChange={(checked) =>
            setSettingsDraft((current) => ({
              ...current,
              backgroundBehavior: checked ? 'keep' : 'stop',
            }))
          }
        />
      </section>
    </div>
  );
}
