"""The tutor sees the same ordinal as the execution player, alongside its slider value."""
import pytest
from backend.agent_tools import build_system_prompt


@pytest.mark.parametrize('value,minimum,maximum,current,ordinal,total', [
    (0, 0, 24, 0, 1, 25), (3, 0, 24, 3, 4, 25),
    (24, 0, 24, 24, 25, 25), (7, 5, 10, 7, 3, 6),
    (3.5, 0, 24, 4, 5, 25), (30, 0, 24, 24, 25, 25),
])
def test_execution_position(value, minimum, maximum, current, ordinal, total):
    prompt = build_system_prompt({
        'currentScene': {'stepPlayback': {'slider': 'frame'}},
        'runtime': {'sliders': {'frame': {'value': value, 'min': minimum, 'max': maximum, 'step': 1}}},
    })
    assert f'Execution playback: frame={current}' in prompt
    assert f'player displays {ordinal} / {total}' in prompt
    assert 'not the tick value or lesson step number' in prompt


@pytest.mark.parametrize('scene,runtime', [({}, {}), ({'stepPlayback': {'slider': 'frame'}}, {}),
    ({'stepPlayback': {'slider': 'frame'}}, {'sliders': {'frame': {'value': 3, 'min': 0.5, 'max': 24, 'step': 1}}}),
])
def test_no_playback_context_without_valid_player(scene, runtime):
    assert 'Execution playback:' not in build_system_prompt({'currentScene': scene, 'runtime': runtime})

@pytest.mark.parametrize('surface', [{'userViewing': ['scene', 'chat']}, {'activeTab': 'chat'}])
def test_active_view_includes_execution_position(surface):
    prompt = build_system_prompt({
        'currentScene': {'stepPlayback': {'slider': 'frame'}},
        'runtime': {**surface, 'sliders': {'frame': {'value': 3, 'min': 0, 'max': 24, 'step': 1}}},
    })
    viewing = next(line for line in prompt.splitlines() if 'USER VIEWING:' in line)
    assert 'frame=3, execution position 4 / 25' in viewing
