"""The tutor sees what the execution player shows: the slider value over its maximum."""
import pytest
from backend.agent_tools import build_system_prompt


@pytest.mark.parametrize('value,minimum,maximum,current', [
    (0, 0, 24, 0), (3, 0, 24, 3), (24, 0, 24, 24), (7, 5, 10, 7), (3.5, 0, 24, 4), (30, 0, 24, 24),
])
def test_execution_position(value, minimum, maximum, current):
    prompt = build_system_prompt({
        'currentScene': {'stepPlayback': {'slider': 'frame'}},
        'runtime': {'sliders': {'frame': {'value': value, 'min': minimum, 'max': maximum, 'step': 1}}},
    })
    assert f'Execution playback: frame={current}' in prompt
    assert f'player displays {current} / {maximum}' in prompt
    assert 'not a separate one-based position' in prompt


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
    assert 'frame=3, player shows 3 / 24' in viewing


def test_simulation_state_is_included_verbatim():
    prompt = build_system_prompt({'currentScene': {}, 'runtime': {'simulationState': 'kafka: lag 3, duplicates 1'}})
    assert 'Live simulation state' in prompt
    assert 'kafka: lag 3, duplicates 1' in prompt


@pytest.mark.parametrize('value', [None, '', '   ', 7, ['x']])
def test_simulation_state_omitted_when_absent_or_invalid(value):
    assert 'Live simulation state' not in build_system_prompt({'currentScene': {}, 'runtime': {'simulationState': value}})


def test_screen_values_are_listed_as_shown():
    prompt = build_system_prompt({'currentScene': {}, 'runtime': {'screenValues': ['i = 5', 'x = 3', 'if i ≥ k - 1 → 4 ≥ 2 → True']}})
    line = next(l for l in prompt.splitlines() if 'Values shown on screen now' in l)
    assert 'i = 5 | x = 3 | if i ≥ k - 1 → 4 ≥ 2 → True' in line


@pytest.mark.parametrize('value', [None, [], 'i = 5', [None, {'a': 1}]])
def test_screen_values_omitted_when_absent_or_invalid(value):
    assert 'Values shown on screen now' not in build_system_prompt({'currentScene': {}, 'runtime': {'screenValues': value}})
