# 变量赋值

name = "suizhazha" # 字符串
age = 18 # 整数
boolean = True # False
complex_number=1j # 复数
float_number=1.0 # 浮点数 
none_value = None  # 相当于 JavaScript 的 null
list_data=[1,2,3] # 列表 (可变)
tuple_data=(1,2,3) # 元组 (不可变)
dictionary ={"name":"suizhazha","age":29} # 字典 (可变)
set_data = {1,2,3} # 集合 (可变)

# 解构赋值
first, second = 1, 2
obj = { "name": "suizhazha", "age": 29 }
name, age = obj.values()

print(name, age)

# 模版字符串 f-string
message = f"你好，{name}！你今年{age}岁。"
print(message)

# 类型检测
print(type(name)) # <class 'str'>
print(type(age)) # <class 'int'>
print(type(boolean)) # <class 'bool'>
print(type(complex_number)) # <class 'complex'>
print(type(float_number)) # <class 'float'>
print(type(none_value)) # <class 'NoneType'>
print(type(list_data)) # <class 'list'>
print(type(tuple_data)) # <class 'tuple'>
print(type(dictionary)) # <class 'dict'>
print(type(set_data)) # <class 'set'>
print(isinstance(name, str)) # True
print(isinstance(age, int)) # True
print(isinstance(boolean, bool)) # True
print(isinstance(complex_number, complex)) # True
print(isinstance(float_number, float)) # True
print(isinstance(none_value, NoneType)) # True
print(isinstance(list_data, list)) # True
print(isinstance(tuple_data, tuple)) # True
print(isinstance(dictionary, dict)) # True
print(isinstance(set_data, set)) # True
